import {test} from 'node:test';
import assert from 'node:assert/strict';
import {armFirstVisiblePolygon,readFirstVisiblePolygon,type PolygonObserverScope,type VisiblePolygon} from './helpers/first-visible-polygon.js';

// Intent (ELF-26, delegated observer-only correction): a delayed consumer must not
// change which first-eligible state is asserted, and zero-left must never be filtered.
// Regression replay, NOT a reproduction of ui-07 or proof of displayed frames.
// These three DOM readings are from ELF-26's authorized one-shot, retained in
// evidence/motion-causal/readings.json (summon-return, firstVisible, laterZeroLeftWitness).
// Only the observation boundary is exercised; no clocks, animation or timing is simulated.
const recorded={
 hidden:{clip:'polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%)',rollVisible:false,left:100,top:100},
 firstVisible:{clip:'polygon(59.8108% 91.0622%, 69.8581% 90.1485%, 83.9243% 90.8795%, 100% 90.1485%, 100% 100%, 59.8108% 100%)',rollVisible:true,left:59.8108,top:91.0622},
 laterZero:{clip:'polygon(0% 7.94487%, 25% 7.26599%, 60% 7.80909%, 100% 7.26599%, 100% 100%, 0% 100%)',rollVisible:true,left:0,top:7.94487}
};
type Reading=typeof recorded.hidden;
const expected=(reading:Reading):VisiblePolygon=>({left:reading.left,top:reading.top,rolled:reading.rollVisible});
function replay(initial:Reading){
 const panel={style:{clipPath:initial.clip}},roll={hidden:!initial.rollVisible};
 let callbacks:Array<()=>void>=[];
 const scope:PolygonObserverScope={
  document:{querySelector:selector=>{assert.equal(selector,'.panel');return panel;},getElementById:id=>{assert.equal(id,'ew-roll');return roll;}},
  requestAnimationFrame:callback=>{callbacks.push(callback);return callbacks.length;}
 };
 return {scope,deliver(reading:Reading){
  panel.style.clipPath=reading.clip;roll.hidden=!reading.rollVisible;
  const due=callbacks;callbacks=[];for(const callback of due)callback();
 }};
}

test('ELF-26 observer regression: late consumption retains the first eligible recorded polygon',async()=>{
 const fixture=replay(recorded.hidden);
 assert.equal(armFirstVisiblePolygon(fixture.scope),undefined,'arming must return without waiting for motion');
 fixture.deliver(recorded.firstVisible);
 fixture.deliver(recorded.laterZero);
 assert.deepEqual(await readFirstVisiblePolygon(fixture.scope),expected(recorded.firstVisible));
});

test('ELF-26 observer regression: a first-eligible recorded zero-left state is retained, never skipped',async()=>{
 const fixture=replay(recorded.hidden);
 armFirstVisiblePolygon(fixture.scope);
 fixture.deliver(recorded.laterZero);
 let selected:VisiblePolygon|undefined;
 void readFirstVisiblePolygon(fixture.scope).then(value=>{selected=value;});
 // Flush promise delivery only; there is no sleep or fabricated animation advance.
 await Promise.resolve();
 assert.deepEqual(selected,expected(recorded.laterZero));
});
