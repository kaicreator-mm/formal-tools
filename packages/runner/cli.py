"""Command-line entrypoint. No external Python dependencies."""
import argparse
import json
import sys
from .core import RunnerError, registered, inspect, validate, run_fixture, probe

def main(argv=None):
    parser = argparse.ArgumentParser(description="Versioned formal-fixture runner")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("validate")
    a = sub.add_parser("doctor")
    a.add_argument("tool")
    a.add_argument("--timeout", type=int, default=15)
    a = sub.add_parser("inspect")
    a.add_argument("tool")
    a = sub.add_parser("run")
    a.add_argument("tool")
    a.add_argument("--case", choices=["positive", "negative"], required=True)
    a.add_argument("--timeout", type=int, default=30)
    a = sub.add_parser("suite")
    a.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "list": result = {"tools": registered(), "status": "registry_only"}
        elif args.cmd == "validate": result = validate()
        elif args.cmd == "inspect": result = inspect(args.tool)
        elif args.cmd == "doctor": result = probe(args.tool, args.timeout)
        elif args.cmd == "run": result = run_fixture(args.tool, args.case, args.timeout)
        else:
            values = [run_fixture(t, c, args.timeout) for t in registered() for c in ("positive", "negative")]
            result = {"suite": values, "count": len(values)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if args.cmd == "validate": return 0 if result["status"] == "STATIC_PASS" else 1
        if args.cmd == "doctor": return 0 if result["run_status"] == "EXECUTED" and result["exit_code"] == 0 else 2
        if args.cmd == "run": return 0 if result["test_verdict"] == "PASS" else 2
        if args.cmd == "suite": return 0 if all(x["test_verdict"] == "PASS" for x in values) else 2
        return 0
    except (RunnerError, ValueError, KeyError) as exc:
        print(json.dumps({"status":"ERROR", "error":str(exc)}), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
