"""Interface and user documentation coverage; no native solver execution."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class InterfaceInventoryTests(unittest.TestCase):
    def test_guide_per_tool(self):
        reg = json.loads((ROOT / "registry/SKILL_REGISTRY.json").read_text())
        for entry in reg["tools"]:
            guide = ROOT / "docs" / "tool-guides" / (entry["id"] + ".md")
            self.assertTrue(guide.is_file(), guide)
            text = guide.read_text()
            for heading in ("理论", "架构", "实现", "快速入门", "MCP", "Woodpecker"):
                self.assertIn(heading, text, guide)

    def test_shared_interface_and_ci_contract(self):
        itf = json.loads((ROOT / "registry" / "INTERFACES.json").read_text())
        self.assertEqual(len(itf["tool_ids"]), 13)
        self.assertEqual(len(itf["mcp_tools"]), 4)
        self.assertFalse(itf["security"]["shell"])
        self.assertTrue((ROOT / ".woodpecker" / "formal-static.yaml").is_file())
        self.assertEqual(itf["status"], "SOURCE_IMPLEMENTED_RUNTIME_NOT_RUN")

    def test_all_skills_reference_adapters(self):
        itf = json.loads((ROOT / "registry" / "INTERFACES.json").read_text())
        for tool in itf["tool_ids"]:
            s = (ROOT / "skills" / tool / "SKILL.md").read_text()
            self.assertIn("packages.runner run " + tool, s)
            self.assertIn("run_formal_fixture", s)

if __name__ == "__main__":
    unittest.main()
