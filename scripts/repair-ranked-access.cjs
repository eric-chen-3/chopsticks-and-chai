// Uses the installed Firebase CLI's authenticated API client; never prints credentials.
// Default: inspect only. --apply repairs browser invocation on two named callables.
const path = require('node:path');
const cliRoot = process.argv[2];
if (!cliRoot) throw new Error('Pass the installed firebase-tools package directory.');
const auth = require(path.join(cliRoot, 'lib/auth'));
const {requireAuth} = require(path.join(cliRoot, 'lib/requireAuth'));
const functions = require(path.join(cliRoot, 'lib/gcp/cloudfunctionsv2'));
const run = require(path.join(cliRoot, 'lib/gcp/run'));
(async () => {
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error('Sign in with firebase login first.');
  await requireAuth({project:'chopsticks-and-chai', ...account, nonInteractive:true});
  for (const id of ['rankedMove','rankedProfile']) {
    const fn = await functions.getFunction('chopsticks-and-chai','us-central1',id);
    const service = fn.serviceConfig.service;
    if (!service.includes('/locations/us-central1/services/') || !service.endsWith('/'+id.toLowerCase())) throw new Error('Unexpected service: '+service);
    const policy = await run.getIamPolicy(service);
    const publicInvoker = policy.bindings?.some(b=>b.role==='roles/run.invoker' && !b.condition && b.members?.includes('allUsers'));
    console.log(`${id}: browser invocation ${publicInvoker ? 'enabled' : 'blocked (missing public invoker binding)'}`);
    if (process.argv.includes('--apply') && !publicInvoker) {
      // Retain every other binding, conditional binding, and the concurrency etag.
      policy.bindings ||= [];
      const binding=policy.bindings.find(b=>b.role==='roles/run.invoker' && !b.condition);
      if (binding) binding.members=[...new Set([...(binding.members||[]),'allUsers'])];
      else policy.bindings.push({role:'roles/run.invoker',members:['allUsers']});
      await run.setIamPolicy(service,policy);
      console.log(`${id}: repaired. Firebase Auth and participant validation remain enforced by the callable.`);
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
