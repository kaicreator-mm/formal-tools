"""Static contract tests. They do not execute solver binaries."""
from pathlib import Path
import unittest
from packages.runner import core

class RunnerTests(unittest.TestCase):
    def test_repo_structure(self):
        self.assertEqual(core.validate()["status"], "STATIC_PASS")
        self.assertEqual(len(core.registered()), 13)
    def test_allowlist(self):
        with self.assertRaises(core.RunnerError):
            core.inspect("../../bin/sh")
        with self.assertRaises(core.RunnerError):
            core.run_fixture("z3", "unknown")
    def test_timeout(self):
        with self.assertRaises(core.RunnerError):
            core.run_fixture("z3", "positive", 0)
    def test_z3_parser(self):
        a = {"timed_out": False, "stdout": "unsat\n", "stderr": "", "exit_code": 0}
        self.assertEqual(core.classify("z3", "positive", [a], Path(".")), ("UNSAT","PASS"))
        b = dict(a, stdout="sat\n")
        self.assertEqual(core.classify("z3", "negative", [b], Path(".")), ("SAT","PASS"))
        self.assertEqual(core.classify("z3", "positive", [b], Path("."))[1], "INCONCLUSIVE")
    def test_clingo_nonzero_valid_unsat(self):
        a = {"timed_out": False, "stdout": "UNSATISFIABLE\n", "stderr": "", "exit_code": 20}
        self.assertEqual(core.classify("clingo","negative",[a],Path("."))[1],"PASS")
    def test_unverified_parsers_fail_closed(self):
        a = {"timed_out": False, "stdout": "success", "stderr": "", "exit_code": 0}
        for tool in ("alloy","prob"):
            self.assertEqual(core.classify(tool,"positive",[a],Path("."))[1],"INCONCLUSIVE")

if __name__ == "__main__":
    unittest.main()
