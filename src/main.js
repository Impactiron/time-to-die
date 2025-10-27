(function(){
  // ---- Setup ----
  const gate = document.getElementById('gate');
  const startBtn = document.getElementById('startBtn');
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');

  function resize(){ cvs.width=innerWidth; cvs.height=innerHeight; }
  addEventListener('resize', resize); resize();

  function fmtClock(min){ let h=Math.floor(min/60)%24, m=Math.floor(min%60); const pad=n=>n<10?'0'+n:n; return pad(h)+':'+pad(m); }

  // ---- World constants ----
  const TILE_W=64, TILE_H=32;
  const CHUNK_TILES=48;
  const LOAD_RADIUS=1;
  const BIOME_SCALE=80;
  const TREE_DENS_WALD=0.18, TREE_DENS_WIESE=0.03;
  const PLAYER_SPEED=6/60;

  // ---- Math helpers ----
  const iso=(i,j)=>({x:(i-j)*(TILE_W/2), y:(i+j)*(TILE_H/2)});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function diamond(x,y,w,h,fill){
    ctx.beginPath(); ctx.moveTo(x,y-h/2); ctx.lineTo(x+w/2,y); ctx.lineTo(x,y+h/2); ctx.lineTo(x-w/2,y); ctx.closePath();
    ctx.fillStyle=fill; ctx.fill();
  }
  function rrect(x,y,w,h,r,fill){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    ctx.fillStyle=fill; ctx.fill();
  }
  function seedRand(x){ let t = x += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14)>>>0)/4294967296; }
  function valueNoise2D(ix,iy,scale){
    const x=ix/scale,y=iy/scale; const x0=Math.floor(x),y0=Math.floor(y),x1=x0+1,y1=y0+1;
    const sx=x-x0, sy=y-y0; const lerp=(a,b,t)=>a+(b-a)*t;
    const n=(i,j)=>seedRand((i*374761393)^(j*668265263));
    const n00=n(x0,y0), n10=n(x1,y0), n01=n(x0,y1), n11=n(x1,y1);
    const ix0=lerp(n00,n10,sx), ix1=lerp(n01,n11,sx); return lerp(ix0,ix1,sy);
  }

  // ---- State ----
  const $=id=>document.getElementById(id);
  const state={
    player:{i:0,j:0,speed:PLAYER_SPEED,health:100,hunger:100,thirst:100},
    timeMinutes:12*60,isNight:false,
    wood:0,
    chunks:new Map(), // "cx,cy" -> {trees:Set(id -> {i,j})}
    floats:[]
  };

  function chunkKey(cx,cy){ return cx+','+cy; }
  function worldToChunk(i,j){ const cx=Math.floor(i/CHUNK_TILES), cy=Math.floor(j/CHUNK_TILES); return {cx,cy, li:i-cx*CHUNK_TILES, lj:j-cy*CHUNK_TILES}; }

  function ensureChunk(cx,cy){
    const key=chunkKey(cx,cy); if(state.chunks.has(key)) return state.chunks.get(key);
    const trees=new Map();
    // generate trees
    for(let li=0; li<CHUNK_TILES; li++){
      for(let lj=0; lj<CHUNK_TILES; lj++){
        const wi=cx*CHUNK_TILES+li, wj=cy*CHUNK_TILES+lj;
        const biome=valueNoise2D(wi,wj,BIOME_SCALE);
        const dens = biome>0.55 ? TREE_DENS_WALD : TREE_DENS_WIESE;
        const r=valueNoise2D(wi*13+7,wj*7+11,8);
        if(r<dens){
          const id=wi+','+wj;
          trees.set(id,{i:wi,j:wj});
        }
      }
    }
    const ch={cx,cy,trees}; state.chunks.set(key,ch); $('chunks').textContent=state.chunks.size; return ch;
  }
  function unloadFarChunks(){
    const {cx,cy}=worldToChunk(state.player.i,state.player.j);
    for(const [key,ch] of state.chunks){
      const dx=Math.abs(ch.cx-cx), dy=Math.abs(ch.cy-cy);
      if(dx>LOAD_RADIUS || dy>LOAD_RADIUS) state.chunks.delete(key);
    }
    $('chunks').textContent=state.chunks.size;
  }
  function loadAroundPlayer(){
    const {cx,cy}=worldToChunk(state.player.i,state.player.j);
    for(let x=cx-LOAD_RADIUS;x<=cx+LOAD_RADIUS;x++){
      for(let y=cy-LOAD_RADIUS;y<=cy+LOAD_RADIUS;y++){
        ensureChunk(x,y);
      }
    }
    unloadFarChunks();
  }

  // ---- Input ----
  const down=new Set();
  function setupInput(){
    addEventListener('keydown', e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d','e','i'].includes(k)){ down.add(k); markPad(k,true);} });
    addEventListener('keyup',   e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d','e','i'].includes(k)){ down.delete(k); markPad(k,false);} });
    document.querySelectorAll('#pad button').forEach(btn=>{
      const k=btn.dataset.k;
      btn.addEventListener('pointerdown', e=>{ e.preventDefault(); down.add(k); markPad(k,true);} );
      btn.addEventListener('pointerup',   e=>{ e.preventDefault(); down.delete(k); markPad(k,false);} );
      btn.addEventListener('pointerleave',e=>{ e.preventDefault(); down.delete(k); markPad(k,false);} );
    });
  }
  function markPad(k,on){ const el=document.querySelector(`[data-k="${k}"]`); el&&el.classList.toggle('active',on); }

  // ---- Interact: Chop tree ----
  function tryChop(){
    const pi=state.player.i, pj=state.player.j; const {cx,cy}=worldToChunk(pi,pj); const radius=1.2;
    for(let x=cx-1;x<=cx+1;x++){
      for(let y=cy-1;y<=cy+1;y++){
        const ch=state.chunks.get(chunkKey(x,y)); if(!ch) continue;
        for(const [id,t] of Array.from(ch.trees)){
          const d=Math.hypot(t.i-pi,t.j-pj);
          if(d<=radius){
            ch.trees.delete(id);
            const gained = 1 + ((Math.random()*2)|0);
            state.wood += gained; $('wood').textContent=state.wood;
            spawnFloat(`+Wood ${gained}`, t.i, t.j);
            return true;
          }
        }
      }
    }
    return false;
  }

  function spawnFloat(text, wi, wj){
    const p=iso(wi,wj);
    state.floats.push({text, x:p.x, y:p.y-24, alpha:1});
  }

  // ---- Gate start ----
  function start(){
    gate.style.display='none';
    setupInput();
    loop();
  }
  startBtn.addEventListener('click', start);
  addEventListener('keydown', e=>{ if(gate.style.display!=='none') start(); }, {once:true});

  // ---- Main loop ----
  let frames=0,last=performance.now(), tprev=performance.now();
  function loop(now){
    now = now || performance.now();
    const delta = Math.max(0.0001,(now - tprev)/16.6667);
    tprev = now;
    frames++; if(now-last>1000){ $('fps').textContent=frames; frames=0; last=now; }

    // time
    state.timeMinutes += 0.8*delta; const hour=Math.floor((state.timeMinutes/60)%24);
    state.isNight = hour>=20 || hour<6;
    $('clock').textContent = fmtClock(state.timeMinutes);
    $('phase').textContent = state.isNight? '(Night)':'(Day)';
    $('isNight').textContent = state.isNight;

    // needs (placeholder)
    state.hunger = Math.max(0, (state.hunger??100) - 0.006*delta);
    state.thirst = Math.max(0, (state.thirst??100) - 0.009*delta);
    $('health').textContent = 100;
    $('hunger').textContent = state.hunger.toFixed(0);
    $('thirst').textContent = state.thirst.toFixed(0);

    // input
    let di=0,dj=0; if(down.has('w')) dj-=1; if(down.has('s')) dj+=1; if(down.has('a')) di-=1; if(down.has('d')) di+=1;
    if(di||dj){ const len=Math.hypot(di,dj); di/=len; dj/=len; state.player.i += di*state.player.speed*delta; state.player.j += dj*state.player.speed*delta; }
    if(down.has('e')) tryChop();

    loadAroundPlayer();

    // camera center
    const p=iso(state.player.i,state.player.j);
    const cx=cvs.width/2, cy=cvs.height/2+80;
    const offx=cx - p.x, offy=cy - p.y;

    // draw
    ctx.clearRect(0,0,cvs.width,cvs.height);

    // render tiles in loaded chunks
    for(const ch of state.chunks.values()){
      for(let li=0; li<CHUNK_TILES; li++){
        for(let lj=0; lj<CHUNK_TILES; lj++){
          const wi=ch.cx*CHUNK_TILES+li, wj=ch.cy*CHUNK_TILES+lj;
          const q=iso(wi,wj);
          const biome=valueNoise2D(wi,wj,BIOME_SCALE);
          const col = biome>0.55 ? (((wi+wj)%2===0)?'#15221b':'#18271f') : (((wi+wj)%2===0)?'#1b232b':'#1f2831');
          diamond(q.x+offx, q.y+offy, TILE_W, TILE_H, col);
        }
      }
      // trees
      for(const t of ch.trees.values()){
        const q=iso(t.i,t.j), x=q.x+offx, y=q.y+offy-12;
        ctx.fillStyle='#2e7d32'; ctx.beginPath(); ctx.arc(x,y,12,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#3e2723'; ctx.fillRect(x-2, y, 4, 10);
      }
    }

    // player
    const px=p.x+offx, py=p.y+offy-10;
    ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px,py+10,12,4,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#9ad1ff'; ctx.beginPath(); ctx.arc(px,py,10,0,Math.PI*2); ctx.fill();

    // night overlay
    if(state.isNight){ ctx.fillStyle='rgba(0,0,16,0.45)'; ctx.fillRect(0,0,cvs.width,cvs.height); }

    // floats
    for(let i=state.floats.length-1;i>=0;i--){
      const f=state.floats[i];
      f.y -= 0.4*delta; f.alpha -= 0.015*delta;
      ctx.globalAlpha = Math.max(0,f.alpha);
      ctx.fillStyle='#cde8ff'; ctx.font='bold 14px monospace'; ctx.fillText(f.text, f.x+offx, f.y+offy);
      ctx.globalAlpha = 1;
      if(f.alpha<=0) state.floats.splice(i,1);
    }

    $('pos').textContent = state.player.i.toFixed(2)+','+state.player.j.toFixed(2);

    requestAnimationFrame(loop);
  }
})();