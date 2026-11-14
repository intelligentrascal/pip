// ELF-8: exit after durable admission, before inference can return; no account or native input.
import {openHost} from '../../runtime/pi-durable-adapter.js';
const home=process.argv[2];
const host=await openHost({home,fixture:true,provider:async()=>{process.stdout.write('admitted before interrupted inference\n');process.exit(0);}});
await host.submit('read-project','Draft the remaining Pip release notes.',undefined,undefined,{id:'pip-release',revision:1});
