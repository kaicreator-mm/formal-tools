export type TestVerdict = "PASS" | "COUNTEREXAMPLE" | "INCONCLUSIVE";
export type PureEngine = "dag" | "writers" | "cnf" | "states";
export interface PureResult {
  tool_outcome: string;
  test_verdict: TestVerdict;
  claim_verdict: "NOT_EVALUATED";
  execution: "PURE_JS";
  scope: string;
  [key: string]: unknown;
}
export declare function analyzeDag(input: {nodes: string[]; edges: [string,string][]}): PureResult;
export declare function checkExclusiveWriters(input: {claims: {task:string;resource:string;slot:string}[]}): PureResult;
export declare function solveCnf(input: {variables:number;clauses:number[][]}): PureResult;
export declare function verifyFiniteState(input: {states:string[];initial:string;transitions:[string,string][];allowedStates:string[]}): PureResult;
export declare const ENGINES: Readonly<Record<PureEngine,(model: any)=>PureResult>>;
export declare function verifyPure(kind:PureEngine,model:Record<string,unknown>):PureResult;
