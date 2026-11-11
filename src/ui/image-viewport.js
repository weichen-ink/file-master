/** Pure geometry shared by mouse, keyboard and touch input. Scale is CSS pixels per image pixel. */
export function createViewportModel() {
  const state={width:1,height:1,imageWidth:1,imageHeight:1,scale:1,x:0,y:0,fitScale:1};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const bound=()=>{const dx=Math.max(0,(state.imageWidth*state.scale-state.width)/2),dy=Math.max(0,(state.imageHeight*state.scale-state.height)/2);state.x=clamp(state.x,-dx,dx);state.y=clamp(state.y,-dy,dy);};
  return {state,
    resize(width,height,imageWidth,imageHeight){Object.assign(state,{width:Math.max(1,width),height:Math.max(1,height),imageWidth:Math.max(1,imageWidth),imageHeight:Math.max(1,imageHeight)});state.fitScale=Math.max(.001,Math.min((state.width-24)/state.imageWidth,(state.height-24)/state.imageHeight,1));this.fit();},
    fit(){state.scale=state.fitScale;state.x=state.y=0;},
    actual(){state.scale=1;state.x=state.y=0;bound();},
    zoom(factor,anchor={x:0,y:0}){const old=state.scale;state.scale=clamp(old*factor,Math.min(state.fitScale,.1),8);state.x=anchor.x-(anchor.x-state.x)*state.scale/old;state.y=anchor.y-(anchor.y-state.y)*state.scale/old;bound();},
    pan(dx,dy){state.x+=dx;state.y+=dy;bound();}
  };
}
export function mountImageViewport(stage,image,onScale) {
  const controller=new AbortController(),{signal}=controller,model=createViewportModel(),pointers=new Map();
  let lastPinch=null,lastTap=null,tapStart=null;
  const draw=()=>{const s=model.state;image.style.width=s.imageWidth+'px';image.style.height=s.imageHeight+'px';image.style.transform=`translate(${s.x}px,${s.y}px) scale(${s.scale})`;stage.toggleClass('can-pan',s.imageWidth*s.scale>s.width||s.imageHeight*s.scale>s.height);onScale(Math.round(s.scale*100));};
  const resize=()=>{if(!image.naturalWidth)return;model.resize(stage.clientWidth,stage.clientHeight,image.naturalWidth,image.naturalHeight);draw();};
  const center=event=>{const rect=stage.getBoundingClientRect();return{x:event.clientX-rect.left-stage.clientWidth/2,y:event.clientY-rect.top-stage.clientHeight/2};};
  const pinch=()=>{const [a,b]=[...pointers.values()];return{distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};};
  image.draggable=false;
  image.addEventListener('load',resize,{signal});if(image.complete&&image.naturalWidth)resize();
  stage.addEventListener('wheel',event=>{event.preventDefault();model.zoom(Math.exp(-event.deltaY*.002),center(event));draw();},{passive:false,signal});
  stage.addEventListener('pointerdown',event=>{if(event.button!==0||pointers.size>=2)return;event.preventDefault();stage.focus({preventScroll:true});pointers.set(event.pointerId,center(event));stage.setPointerCapture(event.pointerId);tapStart=pointers.size===1?{...center(event),time:event.timeStamp}:null;if(pointers.size===2){lastPinch=pinch();lastTap=null;}stage.addClass('is-dragging');},{signal});
  stage.addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId))return;const before=pointers.get(event.pointerId),after=center(event);pointers.set(event.pointerId,after);if(pointers.size===2){const current=pinch();if(lastPinch?.distance){model.zoom(current.distance/lastPinch.distance,lastPinch.center);model.pan(current.center.x-lastPinch.center.x,current.center.y-lastPinch.center.y);}lastPinch=current;}else model.pan(after.x-before.x,after.y-before.y);draw();},{signal});
  const release=event=>{
    if(event.type==='pointerup'&&event.pointerType==='touch'&&tapStart&&pointers.size===1){
      const point=center(event),short=event.timeStamp-tapStart.time<300&&Math.hypot(point.x-tapStart.x,point.y-tapStart.y)<10;
      if(short&&lastTap&&event.timeStamp-lastTap.time<350&&Math.hypot(point.x-lastTap.x,point.y-lastTap.y)<24){model.fit();draw();lastTap=null;}
      else lastTap=short?{...point,time:event.timeStamp}:null;
    }
    tapStart=null;pointers.delete(event.pointerId);lastPinch=null;if(!pointers.size)stage.removeClass('is-dragging');};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,release,{signal});
  stage.addEventListener('dblclick',event=>{event.preventDefault();model.fit();draw();},{signal});
  stage.addEventListener('keydown',event=>{const moves={ArrowLeft:[32,0],ArrowRight:[-32,0],ArrowUp:[0,32],ArrowDown:[0,-32]};if(moves[event.key]){event.preventDefault();model.pan(...moves[event.key]);}else if(['+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='0')model.fit();else model.zoom(event.key==='-'?1/1.25:1.25);}else return;draw();},{signal});
  const observer=new ResizeObserver(resize);observer.observe(stage);
  return {fit(){model.fit();draw();},actual(){model.actual();draw();},zoomIn(){model.zoom(1.25);draw();},zoomOut(){model.zoom(1/1.25);draw();},dispose(){controller.abort();observer.disconnect();pointers.clear();}};
}
