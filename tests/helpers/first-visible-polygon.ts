export type VisiblePolygon={left:number,top:number,rolled:boolean};
// The narrow browser interface also lets the observer contract replay real DOM readings.
export type PolygonObserverScope={
 document:{
  querySelector(selector:string):{style:{clipPath:string}}|null;
  getElementById(id:string):{hidden:boolean}|null;
 };
 requestAnimationFrame(callback:()=>void):number;
 __pipFirstVisiblePolygon?:Promise<VisiblePolygon>;
};

// Intent (ELF-26, delegated motion judgment): arm before summon without waiting for
// motion; retain the first eligible reading even when the later consumer is slow.
// Self-contained functions are serialized by page.evaluate, not loaded by the product.
export function armFirstVisiblePolygon(scope:PolygonObserverScope=globalThis as unknown as PolygonObserverScope):void{
 scope.__pipFirstVisiblePolygon=new Promise<VisiblePolygon>(resolve=>{
  const panel=scope.document.querySelector('.panel')!;
  const sample=()=>{
   const m=/^polygon\((.*)\)$/.exec(panel.style.clipPath);
   if(!m||scope.document.getElementById('ew-roll')!.hidden){scope.requestAnimationFrame(sample);return;}
   const first=m[1].split(',')[0].trim().split(/\s+/).map(parseFloat);
   resolve({left:first[0],top:first[1],rolled:!scope.document.getElementById('ew-roll')!.hidden});
  };
  sample();
 });
}

export function readFirstVisiblePolygon(scope:PolygonObserverScope=globalThis as unknown as PolygonObserverScope):Promise<VisiblePolygon>{
 if(!scope.__pipFirstVisiblePolygon)throw Error('Arm the first-visible polygon observer before summon');
 return scope.__pipFirstVisiblePolygon;
}
