# Native CLI 完整能力访问与类型化封装（R4）

**定义**：全部官方 CLI 参数通过可信本地 CLI 的 `native` 模式原样透传；53 个常用操作额外提供校验参数的 `plan` / `exec` 接口。这不等于所有官方参数已逐个类型化，也不等于当前环境已执行过 13 个二进制。

## 执行入口

```bash
node packages/runner/js/cli.mjs catalog
node packages/runner/js/cli.mjs catalog z3
node packages/runner/js/cli.mjs native-help cvc5
node packages/runner/js/cli.mjs plan z3 solve --input problem.smt2
node packages/runner/js/cli.mjs exec z3 solve --input problem.smt2 --timeout 30
node packages/runner/js/cli.mjs native z3 -- -smt2 problem.smt2
node packages/runner/js/cli.mjs native lean4 --entry lake -- test
node packages/runner/js/cli.mjs native tla-tlc --entry sany -- -help
node packages/runner/js/cli.mjs native apache-jena --entry riot -- --help
```

命令后面的 `--` 是原生参数分隔符；后面的所有参数按原始顺序传递给所选官方 CLI（无 shell）。`native` 只允许本地用户从清单指定的工具及子 CLI 中选择，**MCP 不开放 raw**；不可信代码不得通过这种方式执行。`exec` 是结构化操作，输出进程运行收据而不是业务命题证明。

## 工具与操作覆盖

| 工具 | 原生 CLI 子入口 | 已类型化操作数 | 操作名 | 官方资料 |
|---|---|---:|---|---|
| lean4 | `lean`、`lake` | 8 | `check`、`build`、`test`、`lint`、`check-build`、`check-test`、`check-lint`、`query` | [官方说明](https://lean-lang.org/doc/reference/latest/Build-Tools-and-Distribution/Lake/) |
| z3 | `z3` | 2 | `solve`、`dimacs` | [官方说明](https://github.com/Z3Prover/z3) |
| cvc5 | `cvc5` | 2 | `solve`、`sygus` | [官方说明](https://cvc5.github.io/docs/latest/options.html) |
| tla-tlc | `tlc`、`sany`、`pcal`、`xml-exporter` | 5 | `check`、`simulate`、`parse`、`pluscal`、`xml` | [官方说明](https://github.com/tlaplus/tlaplus/blob/master/USE.md) |
| apalache | `apalache-mc` | 5 | `check`、`parse`、`typecheck`、`simulate`、`test` | [官方说明](https://apalache-mc.org/docs/apalache/running.html) |
| alloy | `alloy` | 3 | `exec`、`help`、`lsp` | [官方说明](https://github.com/AlloyTools/org.alloytools.alloy/releases) |
| souffle | `souffle` | 4 | `run`、`compile`、`generate`、`parse` | [官方说明](https://souffle-lang.github.io/execute) |
| rdf-shacl | `pyshacl` | 1 | `validate` | [官方说明](https://github.com/RDFLib/pySHACL) |
| vampire | `vampire` | 3 | `prove`、`casc`、`casc-sat` | [官方说明](https://github.com/vprover/vampire) |
| clingo | `clingo` | 3 | `solve`、`ground`、`solve-json` | [官方说明](https://potassco.org/clingo/) |
| apache-jena | `riot`、`arq`、`sparql`、`qparse`、`uparse`、`update`、`turtle`、`ntriples`、`nquads` | 6 | `validate`、`convert`、`query`、`parsequery`、`parseupdate`、`update` | [官方说明](https://jena.apache.org/documentation/tools/) |
| prob | `probcli` | 4 | `check`、`bounded`、`animate`、`no-deadlock` | [官方说明](https://prob.cs.uni-duesseldorf.de/w/index.php?title=Using_the_Command-Line_Version_of_ProB) |
| dafny | `dafny` | 7 | `verify`、`resolve`、`build`、`run`、`test`、`format-check`、`format-print` | [官方说明](https://dafny.org/dafny/DafnyRef/DafnyRef) |
| **共计** | | **53** | 官方其余选项通过本地 raw 透传；逐版本动态 `native-help` | |

## 适配范围及可信边界

1. `catalog`、`plan` 在不安装证明器的环境里检查静态能力、类型和值；执行不受支持时不得宣称 PASS。
2. `native-help` 必须实际读取当前安装版本的帮助文本。官方帮助是该安装包的参数权威；新增/废弃参数无法仅靠文档静态推断。
3. `exec` 仅提供已声明的常用操作；`native` 能接收所有官方参数，但这些参数本身可修改文件、联网或运行子进程，必须在可信的本地执行环境中由用户明确使用。
4. Node 子进程调用采用 `shell:false`、超时与输出大小限制；并不等价于 OS 级权限隔离。
5. MCP 仅开放 `describe_native_cli` 和 **仅返回 argv** 的 `plan_native_cli`；原有 `run_formal_fixture` 仍然只允许仓库固定测试输入。
6. 实际执行状态以 Git SHA、工具版本、argv、stdout/stderr SHA 和正反例结果记录；退出码 0 不自动等于业务命题证明通过。

## 当前验证

静态规划已对 13 个工具、53 个操作生成 argv；原生程序完整 CLI 运行验收仍为 `NOT_RUN`。本地验收主任务：Issue #4，见 [交接说明](../validation/LOCAL_NATIVE_ACCEPTANCE.md)。
