/**
 * Issue #11 G6: guard an original DIS checkout's full tracked source tree.
 * Exact HEAD plus ten selected blobs is insufficient when tests import more
 * tracked modules. A dirty/staged/untracked source must not be treated as
 * byte-identical original target execution.
 *
 * This guard is engineering-only. It cannot attest ignored node_modules,
 * dependencies, the executing Host, or prevent concurrent post-check swaps.
 */
import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

const fail=code=>{throw Object.assign(new Error(code),{code})};
const safeEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>
  !k.startsWith('GIT_')));
const git=(root,args)=>{
  const r=spawnSync('git',['--no-optional-locks','-C',root,
    '-c','core.fsmonitor=false','-c','core.ignorestat=false',...args],{
    encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,env:safeEnv()
  });
  if(r.error||r.status!==0||r.signal||typeof r.stdout!=='string'||r.stderr?.includes('fatal:'))
    fail('DIS_ORIGINAL_GIT_INSPECTION_FAILED');
  return r.stdout;
};
/** Fail closed on any changed tracked, staged, or non-ignored untracked path.
 * @param {string} root
 */
export function verifyCleanOriginalGitWorktree(root){
  if(typeof root!=='string'||!isAbsolute(root))fail('DIS_ORIGINAL_ROOT_INVALID');
  let canonical;try{canonical=realpathSync(root)}catch{fail('DIS_ORIGINAL_ROOT_INVALID')}
  const toplevel=git(canonical,['rev-parse','--show-toplevel']).trim();
  if(resolve(toplevel)!==resolve(canonical))fail('DIS_ORIGINAL_ROOT_NOT_TOPLEVEL');
  // --porcelain=v1 is stable and covers staged, unstaged and non-ignored
  // untracked inputs. Exit code 0 does NOT imply the tree is clean.
  const status=git(canonical,['status','--porcelain=v1','--untracked-files=all',
    '--ignore-submodules=none']);
  if(status.length!==0)fail('DIS_ORIGINAL_WORKTREE_DRIFT');
  return Object.freeze({tracked_worktree_clean:true,
    nonignored_untracked_sources_absent:true,
    ignored_dependencies_independently_attested:false,
    race_free_execution_attested:false});
}