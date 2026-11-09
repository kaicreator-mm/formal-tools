"""Formal tools: fixed local fixtures, bounded subprocesses, no shell."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "validation" / "SKILL_ACCEPTANCE_CASES.json"
REGISTRY = ROOT / "registry" / "SKILL_REGISTRY.json"
TOOLS = ("lean4", "z3", "tla-tlc", "apalache", "alloy", "souffle", "rdf-shacl", "cvc5", "vampire", "clingo", "apache-jena", "prob", "dafny")

class RunnerError(ValueError):
    pass

def registered():
    return sorted(x["id"] for x in json.loads(REGISTRY.read_text())["tools"])

def inspect(tool):
    if tool not in TOOLS:
        raise RunnerError("Unknown tool")
    return next(c for c in json.loads(CASES.read_text())["cases"] if c["id"] == tool)

def validate():
    failures = []
    if set(registered()) != set(TOOLS):
        failures.append("tool registry mismatch")
    for tool in TOOLS:
        f = ROOT / "skills" / tool / "SKILL.md"
        if not f.is_file() or not f.read_text().startswith("---\nname: " + tool + "\n"):
            failures.append("skill missing or invalid: " + tool)
        entry = inspect(tool)
        for kind in ("positive_command", "negative_command"):
            names = re.findall(r"examples/([\w.-]+)", entry[kind])
            if not names:
                failures.append("fixtures missing: " + tool + "/" + kind)
            for n in names:
                if not (ROOT / "skills" / tool / "examples" / n).is_file():
                    failures.append("fixture missing: " + tool + "/" + n)
    return {"status": "STATIC_PASS" if not failures else "STATIC_FAIL", "runtime": "NOT_RUN", "failures": failures}

def executable(name):
    folder = os.getenv("FORMAL_TOOLS_BIN_DIR")
    if folder and (Path(folder) / name).is_file():
        return str((Path(folder) / name).resolve())
    s = shutil.which(name)
    if not s:
        raise RunnerError("Missing executable: " + name)
    return s

def probe(tool, timeout_s=15):
    """Attempt to start a trusted tool and collect its version/help response.

    This reports a process invocation, not certified tool compatibility.
    """
    inspect(tool)
    if type(timeout_s) is not int or not 1 <= timeout_s <= 120:
        raise RunnerError("timeout must be 1..120 seconds")
    if tool == "lean4": argv = [executable("lean"), "--version"]
    elif tool == "z3": argv = [executable("z3"), "-version"]
    elif tool == "cvc5": argv = [executable("cvc5"), "--version"]
    elif tool == "vampire": argv = [executable("vampire"), "--help"]
    elif tool == "clingo": argv = [os.getenv("FORMAL_CLINGO_PYTHON", sys.executable), "-m", "clingo", "--version"]
    elif tool == "rdf-shacl": argv = [os.getenv("FORMAL_PYSHACL_PYTHON", sys.executable), "-m", "pyshacl", "--help"]
    elif tool == "souffle": argv = [executable("souffle"), "--version"]
    elif tool == "apalache": argv = [executable("apalache-mc"), "--version"]
    elif tool == "dafny": argv = [executable("dafny"), "--version"]
    elif tool == "prob": argv = [executable("probcli"), "-version"]
    elif tool == "apache-jena": argv = [executable("riot"), "--help"]
    elif tool == "alloy":
        jar = os.getenv("FORMAL_ALLOY_JAR")
        argv = ([executable("java"), "-jar", str(Path(jar).resolve()), "help"]
                if jar and Path(jar).is_file() else [executable("alloy"), "help"])
    else:
        jar = os.getenv("TLA2TOOLS_JAR")
        if not jar or not Path(jar).is_file(): raise RunnerError("Missing TLA2TOOLS_JAR")
        argv = [executable("java"), "-cp", str(Path(jar).resolve()), "tlc2.TLC", "-help"]
    try:
        p = subprocess.run(argv, capture_output=True, input=b"", timeout=timeout_s, shell=False)
        raw = p.stdout + p.stderr
        return {"tool": tool, "run_status": "EXECUTED", "argv": argv,
                "exit_code": p.returncode, "output_excerpt": raw.decode("utf-8", "replace")[:2000],
                "output_sha256": hashlib.sha256(raw).hexdigest(),
                "version_verdict": "UNVERIFIED"}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"tool": tool, "run_status": "NOT_RUN", "version_verdict": "UNVERIFIED",
                "error": str(exc)}

def commands(tool, case, output):
    base = ROOT / "skills" / tool / "examples"
    p = case == "positive"
    n = "positive" if p else "negative"
    f = lambda name: str(base / name)
    if tool == "z3": return [[executable("z3"), "-smt2", f(n+".smt2")]]
    if tool == "cvc5": return [[executable("cvc5"), "--lang", "smt2", f(n+".smt2")]]
    if tool == "lean4": return [[executable("lean"), f("Positive.lean" if p else "Negative.lean")]]
    if tool == "dafny": return [[executable("dafny"), "verify", f("Positive.dfy" if p else "Negative.dfy")]]
    if tool == "vampire": return [[executable("vampire"), "--mode", "casc", f(n+".p")]]
    if tool == "clingo": return [[os.getenv("FORMAL_CLINGO_PYTHON", sys.executable), "-m", "clingo", f(n+".lp"), "0"]]
    if tool == "rdf-shacl": return [[os.getenv("FORMAL_PYSHACL_PYTHON", sys.executable), "-m", "pyshacl", "-s", f("shapes.ttl"), "-df", "turtle", "-sf", "turtle", "-f", "human", f(n+".ttl")]]
    if tool == "souffle": return [[executable("souffle"), f(n+".dl"), "-D", str(output)]]
    if tool == "tla-tlc":
        jar = os.getenv("TLA2TOOLS_JAR")
        if not jar or not Path(jar).is_file(): raise RunnerError("Missing TLA2TOOLS_JAR")
        return [[executable("java"), "-cp", str(Path(jar).resolve()), "tlc2.TLC", "-config", f("Toggle.cfg"), f("TogglePositive.tla" if p else "ToggleNegative.tla")]]
    if tool == "apalache": return [[executable("apalache-mc"), "check", "--init=Init", "--next=Next", "--inv=Inv", "--length=3", f("TogglePositive.tla" if p else "ToggleNegative.tla")]]
    if tool == "alloy":
        jar = os.getenv("FORMAL_ALLOY_JAR")
        prefix = [executable("java"), "-jar", str(Path(jar).resolve())] if jar and Path(jar).is_file() else [executable("alloy")]
        return [prefix + ["exec", "-c", "0", f(n+".als")]]
    if tool == "prob": return [[executable("probcli"), f("Positive.mch" if p else "Negative.mch"), "-model_check"]]
    if tool == "apache-jena":
        steps = [[executable("riot"), "--validate", f("data.ttl" if p else "invalid.ttl")]]
        if p: steps.append([executable("arq"), "--data", f("data.ttl"), "--query", f("query.rq")])
        return steps
    raise RunnerError("Unsupported tool")

def classify(tool, case, outputs, outdir):
    if not outputs or any(x["timed_out"] for x in outputs): return ("UNKNOWN", "INCONCLUSIVE")
    alltext = "\n".join(x["stdout"] + "\n" + x["stderr"] for x in outputs)
    low = alltext.lower()
    rc = outputs[-1]["exit_code"]
    pos = case == "positive"
    if tool in ("z3", "cvc5"):
        m = re.findall(r"(?m)^\s*(sat|unsat|unknown)\s*$", low)
        value = m[-1] if m else "unparsed"
        return (value.upper(), "PASS" if value == ("unsat" if pos else "sat") else "INCONCLUSIVE")
    if tool == "clingo":
        status = "UNSATISFIABLE" if re.search(r"(?m)^UNSATISFIABLE\s*$", alltext) else "SATISFIABLE" if re.search(r"(?m)^SATISFIABLE\s*$", alltext) else "UNPARSED"
        models = len(re.findall(r"(?m)^Answer:\s*\d+", alltext))
        good = (status == "SATISFIABLE" and models == 2) if pos else status == "UNSATISFIABLE"
        return (status, "PASS" if good else "INCONCLUSIVE")
    if tool == "rdf-shacl":
        m = re.search(r"Conforms:\s*(True|False)", alltext, re.I)
        value = m.group(1).lower() if m else "unparsed"
        return (value.upper(), "PASS" if value == ("true" if pos else "false") else "INCONCLUSIVE")
    if tool == "lean4":
        good = (rc == 0 and "sorry" not in low) if pos else (rc not in (0, None) and any(x in low for x in ("unsolved goals", "type mismatch")))
        return ("PROVED" if pos and good else "REJECTED" if good else "UNPARSED", "PASS" if good else "INCONCLUSIVE")
    if tool == "dafny":
        good = (rc == 0 and re.search(r"verified,\s*0\s*errors", low)) if pos else (rc not in (0, None) and "postcondition" in low)
        return ("VERIFIED" if pos and good else "REFUTED" if good else "UNPARSED", "PASS" if good else "INCONCLUSIVE")
    if tool == "vampire":
        theorem = bool(re.search(r"SZS status Theorem\b", alltext))
        if theorem and not pos: return ("THEOREM", "FAIL")
        return ("THEOREM" if theorem else "UNKNOWN", "PASS" if theorem and pos else "INCONCLUSIVE")
    if tool == "souffle":
        cycles = outdir / "cycle.csv"
        reach = outdir / "reach.csv"
        if rc != 0 or not cycles.is_file() or not reach.is_file(): return ("UNPARSED", "INCONCLUSIVE")
        nodes = [x for x in cycles.read_text().splitlines() if x.strip()]
        edges = reach.read_text().replace("\t", ",")
        good = bool("A,C" in edges and not nodes) if pos else bool(nodes)
        return ("CYCLIC" if nodes else "ACYCLIC", "PASS" if good else "INCONCLUSIVE")
    if tool == "apache-jena":
        good = (all(x["exit_code"] == 0 for x in outputs) and "urn:a" in low and "urn:b" in low) if pos else (rc not in (0, None) and any(x in low for x in ("riotexception", "parseexception", "syntax error")))
        return ("QUERY_MATCH" if pos and good else "INVALID_TURTLE" if good else "UNPARSED", "PASS" if good else "INCONCLUSIVE")
    if tool == "tla-tlc":
        violation = "invariant" in low and "violat" in low
        good = (rc == 0 and ("model checking completed" in low or "finished in" in low) and not violation) if pos else violation
        return ("BOUNDED_SAFE" if pos and good else "COUNTEREXAMPLE" if good else "UNPARSED", "PASS" if good else "INCONCLUSIVE")
    if tool == "apalache":
        violation = "counterexample" in low or "invariant is violated" in low
        good = (rc == 0 and "checker reports no error" in low) if pos else violation
        return ("BOUNDED_SAFE" if pos and good else "COUNTEREXAMPLE" if good else "UNPARSED", "PASS" if good else "INCONCLUSIVE")
    # Alloy/ProB output conventions must be frozen from real receipts.
    return ("UNPARSED", "INCONCLUSIVE")

def run_fixture(tool, case, timeout_s=30):
    inspect(tool)
    if case not in ("positive", "negative"): raise RunnerError("case must be positive or negative")
    if type(timeout_s) is not int or timeout_s < 1 or timeout_s > 120: raise RunnerError("timeout must be 1..120 seconds")
    inputs = ROOT / "skills" / tool / "examples"
    with tempfile.TemporaryDirectory(prefix="formal-") as temp:
        output = Path(temp)
        try:
            steps = commands(tool, case, output)
            executions = []
            for argv in steps:
                start = time.monotonic()
                try:
                    p = subprocess.run(argv, cwd=output, capture_output=True, input=b"", timeout=timeout_s, shell=False)
                    stdout, stderr, rc, timed_out = p.stdout, p.stderr, p.returncode, False
                except subprocess.TimeoutExpired as exc:
                    stdout, stderr, rc, timed_out = exc.stdout or b"", exc.stderr or b"", None, True
                record = {
                    "argv": argv, "exit_code": rc, "timed_out": timed_out,
                    "stdout": stdout.decode("utf-8", "replace")[:6000],
                    "stderr": stderr.decode("utf-8", "replace")[:6000],
                    "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
                    "stderr_sha256": hashlib.sha256(stderr).hexdigest(),
                    "elapsed_ms": round((time.monotonic()-start)*1000)
                }
                executions.append(record)
                if rc != 0 or timed_out: break
            outcome, verdict = classify(tool, case, executions, output)
        except (OSError, RunnerError) as exc:
            return {"tool": tool, "case": case, "run_status": "NOT_RUN", "tool_outcome": "ERROR", "test_verdict": "INCONCLUSIVE", "error": str(exc)}
        input_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs.iterdir() if p.is_file()}
        return {
            "tool": tool, "case": case, "run_status": "EXECUTED",
            "tool_outcome": outcome, "test_verdict": verdict,
            "claim_verdict": "NOT_EVALUATED", "input_sha256": input_hashes,
            "executions": executions, "runtime_scope": "versioned demo fixture only"
        }
