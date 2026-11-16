// ELF-8: exit after durable admission, before inference can return; no account or native input.
import {openHost} from '../../runtime/pi-durable-adapter.js';
import {fauxEngine} from '../helpers/faux-engine.js';
const home=process.argv[2];
const {faux,engine}=fauxEngine();
faux.setResponses([()=>{process.stdout.write('admitted before interrupted inference\n');process.exit(0);}]);
const host=await openHost({home,fixture:true,engine});
await host.submit('read-project','Draft the remaining Pip release notes.',undefined,undefined,{id:'pip-release',revision:1});
