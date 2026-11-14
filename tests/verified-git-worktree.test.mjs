import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyCleanOriginalGitWorktree} from '../packages/runner/js/verified-git-worktree.mjs';
const git=(root,...args)=>{
  const x=spawnSync('git',['-C',root,...args],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);return x.stdout;
};
const setup=()=>{
  const root=mkdtempSync(join(tmpdir(),'ft-i11-dis-clean-tree-'));
  git(root,'init','-q');
  writeFileSync(join(root,'entry.mjs'),"export const f=()=>false;\n");
  git(root,'add','entry.mjs');
  git(root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture');
  return root;
};
const dispose=root=>rmSync(root,{force:true,recursive:true});
test('G6 original checkout: exact clean tracked tree is engineering-ready only',()=>{
  const root=setup();try{
    const r=verifyCleanOriginalGitWorktree(root);
    assert.equal(r.tracked_worktree_clean,true);
    assert.equal(r.ignored_dependencies_independently_attested,false);
    assert.equal(r.race_free_execution_attested,false);
  }finally{dispose(root)}
});
test('G6 original checkout: changed unpinned transitive tracked source is rejected',()=>{
  const root=setup();try{
    appendFileSync(join(root,'entry.mjs'),"export const tampered=true;\n");
    assert.throws(()=>verifyCleanOriginalGitWorktree(root),/DIS_ORIGINAL_WORKTREE_DRIFT/);
  }finally{dispose(root)}
});
test('G6 original checkout: staged executable-source change is rejected',()=>{
  const root=setup();try{
    appendFileSync(join(root,'entry.mjs'),"export const tampered=true;\n");
    git(root,'add','entry.mjs');
    assert.throws(()=>verifyCleanOriginalGitWorktree(root),/DIS_ORIGINAL_WORKTREE_DRIFT/);
  }finally{dispose(root)}
});
test('G6 original checkout: untracked injected module is rejected',()=>{
  const root=setup();try{
    writeFileSync(join(root,'injected.mjs'),"export const fakePass=true;\n");
    assert.throws(()=>verifyCleanOriginalGitWorktree(root),/DIS_ORIGINAL_WORKTREE_DRIFT/);
  }finally{dispose(root)}
});
test('G6 original checkout: no arbitrary root or missing Git repo accepted',()=>{
  assert.throws(()=>verifyCleanOriginalGitWorktree('relative/path'),/DIS_ORIGINAL_ROOT_INVALID/);
  const root=mkdtempSync(join(tmpdir(),'ft-i11-dis-no-git-'));
  try{assert.throws(()=>verifyCleanOriginalGitWorktree(root),/DIS_ORIGINAL_GIT_INSPECTION_FAILED/)}
  finally{dispose(root)}
});
