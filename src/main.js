(function(){
  // Kurz-Helper
  const $ = id => document.getElementById(id);

  // Canvas & Context
  const cvs = $("game");
  const ctx = cvs.getContext("2d",{alpha:false});
  function resize(){cvs.width=innerWidth;cvs.height=innerHeight;}
  addEventListener("resize",resize);resize();

  // Start-Gate
  let started=false;
  const gate=$("gate");
  function start(){
    if(started) return;
    started=true;
    gate.style.display="none";
    cvs.style.pointerEvents="auto";
    setupInput();
    initWorld();
    loop();
  }
  window.__start=start;
  ["click","pointerdown","touchstart","keydown"].forEach(ev=>{
    addEventListener(ev,()=>!started&&start(),{once:false});
  });
  if(new URLSearchParams(location.search).get("autostart")==="1")
    setTimeout(start,50);
  setTimeout(()=>!started&&start(),2000);

  // Welt-Parameter
  const TILE_W=64,TILE_H=32,CHUNK=48,BIOME_SCALE=80;
  const speed=6/60;
  const randSeed=x=>{
    let t=x+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return((t^t>>>14)>>>0)/4294967296;
  };
  const noise=(ix,iy,s)=>{
    const x=ix/s,y=iy/s;
    const x0=Math.floor(x),y0=Math.floor(y),x1=x0+1,y1=y0+1;
    const sx=x-x0,sy=y-y0;
    const lerp=(a,b,t)=>a+(b-a)*t;
    const n=(i,j)=>randSeed((i*374761393)^(j*668265263));
    const n00=n(x0,y0),n10=n(x1,y0),n01=n(x0,y1),n11=n(x1,y1);
    const ix0=lerp(n00,n10,sx),ix1=lerp(n01,n11,sx);
    return lerp(ix0,ix1,sy);
  };
  function diamond(x,y,w,h,col){
    ctx.beginPath();
    ctx.moveTo(x,y-h/2);
    ctx.lineTo(x+w/2,y);
    ctx.lineTo(x,y+h/2);
    ctx.lineTo(x-w/2,y);
    ctx.closePath();
    ctx.fillStyle=col;ctx.fill();
  }

  // Welt-State
  const state={
    player:{i:0,j:0,hunger:100,thirst:100},
    time:12*60,isNight:false,wood:0,chunks:new Map(),
    floats:[],loot:[],inventory:{},tooltip:null
  };

  // Chunk-Mgmt
  function chunkKey(cx,cy){return cx+","+cy;}
  function ensureChunk(cx,cy){
    const key=chunkKey(cx,cy);
    if(state.chunks.has(key)) return state.chunks.get(key);
    const trees=new Map(),loots=[];
    for(let i=0;i<CHUNK;i++)for(let j=0;j<CHUNK;j++){
      const wi=cx*CHUNK+i,wj=cy*CHUNK+j;
      const biome=noise(wi,wj,BIOME_SCALE);
      if(noise(wi*11,wj*9,8)<(biome>0.55?0.18:0.03))
        trees.set(wi+","+wj,{i:wi,j:wj});
      if(noise(wi*7,wj*13,20)<0.002)
        loots.push({i:wi,j:wj,opened:false});
    }
    const ch={cx,cy,trees,loots};
    state.chunks.set(key,ch);
    $("chunks").textContent=state.chunks.size;
    return ch;
  }
  function aroundPlayer(f){
    const {i,j}=state.player;
    const cx=Math.floor(i/CHUNK),cy=Math.floor(j/CHUNK);
    for(let x=cx-1;x<=cx+1;x++)
      for(let y=cy-1;y<=cy+1;y++)
        f(ensureChunk(x,y));
  }
  function unload(){
    const {i,j}=state.player;
    const cx=Math.floor(i/CHUNK),cy=Math.floor(j/CHUNK);
    for(const [k,ch] of state.chunks){
      if(Math.abs(ch.cx-cx)>1||Math.abs(ch.cy-cy)>1)
        state.chunks.delete(k);
    }
  }

  // Bewegung & Eingaben
  const down=new Set();
  function setupInput(){
    addEventListener("keydown",e=>{
      const k=e.key.toLowerCase();
      if(["w","a","s","d","e","i","escape"].includes(k)){
        down.add(k);markPad(k,true);
      }
    });
    addEventListener("keyup",e=>{
      const k=e.key.toLowerCase();
      if(["w","a","s","d","e","i","escape"].includes(k)){
        down.delete(k);markPad(k,false);
      }
    });
    document.querySelectorAll("#pad button").forEach(b=>{
      const k=b.dataset.k;
      b.addEventListener("pointerdown",e=>{e.preventDefault();down.add(k);markPad(k,true);});
      b.addEventListener("pointerup",e=>{e.preventDefault();down.delete(k);markPad(k,false);});
      b.addEventListener("pointerleave",e=>{down.delete(k);markPad(k,false);});
    });
  }
  function markPad(k,on){
    const el=document.querySelector(`[data-k="${k}"]`);
    if(el) el.classList.toggle("active",on);
  }

  // Inventar
  const invEl=$("inventory"),slotsEl=$("slots");
  function renderInventory(){
    slotsEl.innerHTML="";
    for(let i=0;i<8;i++){
      const key=Object.keys(state.inventory)[i];
      const slot=document.createElement("div");
      slot.className="slot";
      if(key){
        slot.textContent=state.inventory[key].icon;
        const c=document.createElement("div");
        c.className="count";
        c.textContent=state.inventory[key].qty;
        slot.appendChild(c);
        slot.dataset.item=key;
      }
      slotsEl.appendChild(slot);
    }
  }
  function toggleInventory(force){
    const open=force!==undefined?force:invEl.classList.contains("hidden");
    invEl.classList.toggle("hidden",!open);
    if(open) renderInventory();
  }
  document.addEventListener("click",e=>{
    const t=e.target;
    if(t.classList.contains("slot")&&t.dataset.item){
      const id=t.dataset.item;
      if(id==="food"){state.player.hunger=Math.min(100,state.player.hunger+25);}
      if(id==="water"){state.player.thirst=Math.min(100,state.player.thirst+25);}
      state.inventory[id].qty--;
      if(state.inventory[id].qty<=0) delete state.inventory[id];
      renderInventory();
      updateHUD();
    }
  });

  // HUD-Update
  function updateHUD(){
    $("hunger").textContent=Math.round(state.player.hunger);
    $("thirst").textContent=Math.round(state.player.thirst);
    $("wood").textContent=state.inventory.wood?state.inventory.wood.qty:0;
  }

  // Loot aufnehmen
  function tryInteract(){
    let acted=false;
    aroundPlayer(ch=>{
      for(const [id,t] of Array.from(ch.trees)){
        const d=Math.hypot(t.i-state.player.i,t.j-state.player.j);
        if(d<1.2){
          ch.trees.delete(id);
          addItem("wood",1+Math.floor(Math.random()*3));
          spawnFloat("+Wood",t.i,t.j);
          acted=true;
          return;
        }
      }
      for(const l of ch.loots){
        const d=Math.hypot(l.i-state.player.i,l.j-state.player.j);
        if(d<1.5&&!l.opened){
          l.opened=true;
          const roll=Math.random();
          if(roll<0.5) addItem("wood",2);
          else if(roll<0.8) addItem("food",1);
          else addItem("water",1);
          spawnFloat("+Loot",l.i,l.j);
          acted=true;
          return;
        }
      }
    });
    if(acted) renderInventory();
  }

  // Items
  const ITEM_DEF={
    wood:{icon:"🪵",name:"Holz"},
    food:{icon:"🍗",name:"Essen"},
    water:{icon:"💧",name:"Wasser"}
  };
  function addItem(id,qty){
    if(!state.inventory[id]) state.inventory[id]={icon:ITEM_DEF[id].icon,qty:0};
    state.inventory[id].qty+=qty;
    updateHUD();
  }

  // Floating Text
  function spawnFloat(txt,i,j){
    const x=(i-j)*(TILE_W/2),y=(i+j)*(TILE_H/2);
    state.floats.push({txt,x,y,alpha:1});
  }

  // Welt-Init
  function initWorld(){
    aroundPlayer(()=>{});
  }

  // Game-Loop
  let frames=0,last=performance.now(),prev=performance.now();
  function loop(now){
    now=now||performance.now();
    const delta=(now-prev)/16.6667;prev=now;
    frames++;if(now-last>1000){$("fps").textContent=frames;frames=0;last=now;}
    unload();aroundPlayer(()=>{});
    // Zeit & Stats
    state.time+=0.8*delta;
    state.player.hunger=Math.max(0,state.player.hunger-0.005*delta);
    state.player.thirst=Math.max(0,state.player.thirst-0.008*delta);
    updateHUD();

    // Bewegung
    let di=0,dj=0;
    if(down.has("w"))dj--;if(down.has("s"))dj++;
    if(down.has("a"))di--;if(down.has("d"))di++;
    if(di||dj){const l=Math.hypot(di,dj);di/=l;dj/=l;
      state.player.i+=di*speed*delta;
      state.player.j+=dj*speed*delta;
    }
    if(down.has("e")) tryInteract();
    if(down.has("i")||down.has("escape")){
      toggleInventory(!invEl.classList.contains("hidden"));
      down.delete("i");down.delete("escape");
    }

    // Zeichnen
    ctx.clearRect(0,0,cvs.width,cvs.height);
    const px=(state.player.i-state.player.j)*(TILE_W/2);
    const py=(state.player.i+state.player.j)*(TILE_H/2);
    const offx=cvs.width/2-px,offy=cvs.height/2+80-py;
    aroundPlayer(ch=>{
      for(let i=0;i<CHUNK;i++)for(let j=0;j<CHUNK;j++){
        const wi=ch.cx*CHUNK+i,wj=ch.cy*CHUNK+j;
        const n=noise(wi,wj,BIOME_SCALE);
        const c=n>0.55?( (wi+wj)%2?"#15221b":"#18271f" ):
                      ( (wi+wj)%2?"#1b232b":"#1f2831" );
        const p=(wi-wj)*(TILE_W/2),q=(wi+wj)*(TILE_H/2);
        diamond(p+offx,q+offy,TILE_W,TILE_H,c);
      }
      // Trees
      for(const t of ch.trees.values()){
        const p=(t.i-t.j)*(TILE_W/2),q=(t.i+t.j)*(TILE_H/2);
        ctx.fillStyle="#2e7d32";
        ctx.beginPath();ctx.arc(p+offx,q+offy-12,12,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#3e2723";ctx.fillRect(p+offx-2,q+offy-2,4,10);
      }
      // Loot-Kisten
      for(const l of ch.loots){
        const p=(l.i-l.j)*(TILE_W/2),q=(l.i+l.j)*(TILE_H/2);
        ctx.fillStyle=l.opened?"#555":"#c58f3d";
        ctx.fillRect(p+offx-8,q+offy-6,16,12);
      }
    });
    // Spieler
    const sx=cvs.width/2,sy=cvs.height/2+70;
    ctx.fillStyle="rgba(0,0,0,.3)";
    ctx.beginPath();ctx.ellipse(sx,sy+10,12,4,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#9ad1ff";
    ctx.beginPath();ctx.arc(sx,sy-10,10,0,Math.PI*2);ctx.fill();

    // Floating texts
    for(let i=state.floats.length-1;i>=0;i--){
      const f=state.floats[i];
      f.y-=0.4*delta;f.alpha-=0.015*delta;
      ctx.globalAlpha=Math.max(0,f.alpha);
      ctx.fillStyle="#cde8ff";
      ctx.font="bold 14px system-ui,monospace";
      ctx.fillText(f.txt,f.x+offx,f.y+offy);
      ctx.globalAlpha=1;
      if(f.alpha<=0) state.floats.splice(i,1);
    }

    $("pos").textContent=state.player.i.toFixed(2)+","+state.player.j.toFixed(2);
    requestAnimationFrame(loop);
  }
})();
