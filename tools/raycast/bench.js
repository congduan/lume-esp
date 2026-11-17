const {spawnSync} = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const cc = spawnSync('gcc',['-O3','-std=c11','-D_POSIX_C_SOURCE=200809L','-I'+path.join(root,'firmware/components/lume-raycast/include'),path.join(__dirname,'bench.c'),path.join(root,'firmware/components/lume-raycast/lume_raycast.c'),'-lm','-o','/tmp/lume-r79-raycast-bench'],{encoding:'utf8'});
if(cc.status) throw Error(cc.stderr);
const c = spawnSync('/tmp/lume-r79-raycast-bench',[],{encoding:'utf8'});if(c.status)throw Error(c.stderr);process.stdout.write(c.stdout);
const qjs = process.env.RAYCAST_QJS || '/tmp/lume-r79-qjs';
if (!process.env.RAYCAST_QJS && !require('fs').existsSync(qjs)) {
  const build = spawnSync('bash',[path.join(__dirname,'build-qjs.sh')],{encoding:'utf8'});
  if (build.error || build.status) throw Error(build.error ? build.error.message : build.stderr);
}
const js = spawnSync(qjs,[path.join(__dirname,'logic.js')],{encoding:'utf8'});
if(js.error || js.status) throw Error(js.error ? js.error.message : js.stderr || `qjs exited ${js.status}`);
process.stdout.write(js.stdout);
