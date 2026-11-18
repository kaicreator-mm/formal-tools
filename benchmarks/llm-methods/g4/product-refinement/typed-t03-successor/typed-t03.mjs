/** Versioned T03 v2, engineering-only candidate. Historical v1 is unchanged.
 * Guard observation is not central admission; composed intent is data only.
 * Supported inputs: bounded own-data JSON records, no getters/proxies,
 * sparse arrays, cycles, non-JSON values or nonstandard prototypes.
 */
import {types} from 'node:util';
import {validateConfirmedIntent} from '../model/t01-intent-model.mjs';
import {decideDownloadConfirmed} from '../model/t03-effect-gate-model.mjs';

export const PROFILE_BOUND = 1048576;
export const MODEL_VERSION = 'formal-tools/t03-typed-successor/2';

/** @param {any} value @param {{remaining:number,active:Set<any>}} budget @param {number} depth @returns {any} */
function captureJson(value,budget,depth){
  if (--budget.remaining < 0 || depth > 32) throw Error('JSON_BUDGET_EXCEEDED');
  if(value===null || typeof value==='string' || typeof value==='boolean') return value;
  if(typeof value==='number' && Number.isFinite(value)) return value;
  if(typeof value!=='object' || types.isProxy(value)) throw Error('NON_JSON_OR_PROXY');
  if(budget.active.has(value)) throw Error('JSON_CYCLE');
  budget.active.add(value);
  try {
    const arr=Array.isArray(value);
    if(Object.getPrototypeOf(value)!==(arr?Array.prototype:Object.prototype)) throw Error('UNSUPPORTED_PROTOTYPE');
    const keys=Reflect.ownKeys(value);
    if(keys.length>4097) throw Error('JSON_BUDGET_EXCEEDED');
    /** @type {any} */
    const out=arr?[]:Object.create(null);
    if(arr){
      const len=Object.getOwnPropertyDescriptor(value,'length')?.value;
      if(!Number.isSafeInteger(len)||len<0||len>4096||keys.length!==len+1) throw Error('INVALID_ARRAY_SHAPE');
      for(let i=0;i<len;i++){
        const d=Object.getOwnPropertyDescriptor(value,String(i));
        if(!d||!d.enumerable||!Object.hasOwn(d,'value')) throw Error('UNSAFE_ARRAY_ENTRY');
        out.push(captureJson(d.value,budget,depth+1));
      }
    }else{
      for(const key of keys){
        if(typeof key!=='string') throw Error('SYMBOL_KEY');
        const d=Object.getOwnPropertyDescriptor(value,key);
        if(!d||!d.enumerable||!Object.hasOwn(d,'value')) throw Error('UNSAFE_PROPERTY');
        Object.defineProperty(out,key,{value:captureJson(d.value,budget,depth+1),enumerable:true});
      }
    }
    return out;
  } finally {budget.active.delete(value)}
}
/** @param {any} payload @returns {any} */
function prepare(payload){
  if(payload===null||typeof payload!=='object'||types.isProxy(payload)||Array.isArray(payload)) throw Error('PAYLOAD_RECORD_REQUIRED');
  return captureJson(payload,{remaining:4096,active:new Set()},0);
}
/** @param {any} prepared */
function classify(prepared){
  if(!Object.hasOwn(prepared,'declaredBytes')) return {kind:'GUARD_FALSE',passed:false,reason:'MISSING_OPERAND'};
  const n=prepared.declaredBytes;
  if(typeof n!=='number') return {kind:'GUARD_FALSE',passed:false,reason:'ORDERED_COMPARISON_TYPE_MISMATCH'};
  return n<=PROFILE_BOUND
    ?{kind:'GUARD_TRUE',passed:true,reason:'FINITE_NUMERIC_LTE'}
    :{kind:'GUARD_FALSE',passed:false,reason:'ABOVE_PROFILE_BOUND'};
}
/** Raw finite/typed Kernel guard direction; deliberately does not issue an intent.
 * @param {any} payload */
export function observeTypedGuard(payload){
  try { return {...classify(prepare(payload)),authority:'NONE',effectDispatched:false}; }
  catch { return {kind:'PREPARATION_ERROR',passed:false,reason:'UNSAFE_OR_NON_JSON_PAYLOAD',authority:'NONE',effectDispatched:false}; }
}
/** @param {string} reason */
const refuse=reason=>({transition:'refuse',targetState:'refused',reason,authority:'NONE',effectDispatched:false,effectIntents:[]});
/** Composed T01 grammar + typed T03 gate. No direct raw-guard acquire intent.
 * @param {any} candidate */
export function decideTypedConfirmed(candidate){
  /** @type {any} */
  let data;
  try { data=prepare(candidate); } catch { return refuse('PREPARATION_ERROR'); }
  const gate=classify(data);
  if(!gate.passed) return refuse(gate.reason);
  const validated=validateConfirmedIntent(data);
  if(!validated.ok) return refuse('T01_GRAMMAR_REFUSED');
  // Only safe captured, T01-projected JSON reaches the unchanged v1 projection.
  const decision=decideDownloadConfirmed(validated.value);
  return {...decision,reason:'T01_AND_TYPED_GUARD_MATCH',authority:'NONE'};
}
