(function(){
  // ---- helpers ----
  function showErr(msg){
    const el=document.getElementById('err'); el.classList.remove('hidden'); el.textContent='⚠️ '+msg;
  }
  function randSeed(x){ // simple xorshift-ish
    let t = x += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function valueNoise2D(ix,iy,scale){
    const x = ix/scale, y = iy/scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0+1, y1=y0+1;
    const sx = x - x0, sy = y - y0;
    function lerp(a,b,t){ return a + (b-a)*t; }
    function n(i,j){ return randSeed((i*374761393) ^ (j*668265263)); }
    const n00=n(x0,y0), n10=n(x1,y0), n01=n(x0,y1), n11=n(x1,y1);
    const ix0 = lerp(n00,n10,sx), ix1 = lerp(n01,n11,sx);
    return lerp(ix0, ix1, sy);
  }

  function run(){
    if(!window.PIXI){ showErr('PIXI nicht geladen (CDN blockiert?)'); return; }

    // ---- constants ----
    const TILE_W=64, TILE_H=32;
    const CHUNK_TILES=48; // 48x48 = performant, schön
    const LOAD_RADIUS=1;  // 3x3 Chunks aktiv
    const BIOME_SCALE=80; // Noise-Skala
    const TREE_DENS_WALD=0.18, TREE_DENS_WIESE=0.03;
    const PLAYER_SPEED=6/60;

    // ---- app ----
    const canvas = document.getElementById('game');
    const gate = document.getElementById('gate');
    const startBtn = document.getElementById('startBtn');

    let app;
    function startPixi(){
      if(app) return;
      app = new PIXI.Application({ view: canvas, resizeTo: window, antialias: true, backgroundColor: 0x0b0d10 });
      initGame();
    }

    // Edge-Fallback: Start via Button/Key
    startBtn.addEventListener('click', ()=>{ gate.style.display='none'; startPixi(); });
    window.addEventListener('keydown', ()=>{ if(gate.style.display!=='none'){ gate.style.display='none'; startPixi(); }});

    // if not Edge, we can autostart (but keeping it simple and safe)
    // startPixi(); // uncomment if you want auto-start

    // ---- world math ----
    const iso=(i,j)=>({x:(i-j)*(TILE_W/2), y:(i+j)*(TILE_H/2)});
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

    // ---- state ----
    const state={
      player:{i:0,j:0,speed:PLAYER_SPEED,health:100,hunger:100,thirst:100},
      timeMinutes:12*60,isNight:false,
      wood:0,
      chunks:new Map(),   // key "cx,cy" -> {container, tilesLayer, objLayer, trees:Set of ids}
      floating:[]         // floating texts
    };

    // HUD refs
    const $=(id)=>document.getElementById(id);
    const fpsEl=$('fps'), posEl=$('pos'), nightEl=$('isNight'), woodEl=$('wood'), chunksEl=$('chunks');

    // ---- scene layers ----
    const world=new PIXI.Container();
    const tilesLayer=new PIXI.Container(), objLayer=new PIXI.Container(), actorLayer=new PIXI.Container(), fxLayer=new PIXI.Container();
    world.addChild(tilesLayer,objLayer,actorLayer,fxLayer);

    // player
    const playerG=new PIXI.Graphics(); actorLayer.addChild(playerG);
    function drawPlayer(){ playerG.clear(); const p=iso(state.player.i,state.player.j); playerG.position.set(p.x,p.y-10);
      playerG.beginFill(0x9ad1ff); playerG.drawCircle(0,0,10); playerG.endFill();
      playerG.beginFill(0x000000,0.30); playerG.drawEllipse(0,10,12,4); playerG.endFill();
    }

    // night overlay
    const night=new PIXI.Graphics(); night.beginFill(0x000010,0.0); night.drawRect(-50000,-50000,100000,100000); night.endFill(); fxLayer.addChild(night);

    // add to stage
    function initGame(){
      app.stage.addChild(world);
      drawPlayer();
      centerCamera();
      setupInput();
      app.ticker.add(tick);
    }

    // ---- chunks ----
    function chunkKey(cx,cy){ return cx+','+cy; }
    function worldToChunk(i,j){
      const cx = Math.floor(i/CHUNK_TILES);
      const cy = Math.floor(j/CHUNK_TILES);
      return {cx,cy, li:i - cx*CHUNK_TILES, lj:j - cy*CHUNK_TILES};
    }

    function ensureChunk(cx,cy){
      const key = chunkKey(cx,cy);
      if(state.chunks.has(key)) return state.chunks.get(key);

      const cTiles=new PIXI.Container(), cObjs=new PIXI.Container();
      tilesLayer.addChild(cTiles); objLayer.addChild(cObjs);

      const trees=new Map(); // id -> {i,j,node}
      // generate tiles & trees using noise
      for(let li=0; li<CHUNK_TILES; li++){
        for(let lj=0; lj<CHUNK_TILES; lj++){
          const wi = cx*CHUNK_TILES + li;
          const wj = cy*CHUNK_TILES + lj;
          const p = iso(wi,wj);
          const biomeN = valueNoise2D(wi,wj,BIOME_SCALE); // 0..1
          const isForest = biomeN > 0.55;
          const tile = new PIXI.Graphics();
          tile.position.set(p.x,p.y);
          const col = isForest ? (( (wi+wj)%2===0 )?0x15221b:0x18271f) : (( (wi+wj)%2===0 )?0x1b232b:0x1f2831);
          tile.beginFill(col);
          tile.moveTo(0,-TILE_H/2); tile.lineTo(TILE_W/2,0); tile.lineTo(0,TILE_H/2); tile.lineTo(-TILE_W/2,0);
          tile.endFill();
          cTiles.addChild(tile);

          // spawn tree?
          const dens = isForest ? TREE_DENS_WALD : TREE_DENS_WIESE;
          const r = valueNoise2D(wi*13+7,wj*7+11,8); // pseudo-rand
          if(r < dens){
            const g = new PIXI.Graphics(); const tp = iso(wi,wj);
            g.position.set(tp.x, tp.y-12);
            // simple tree icon
            g.beginFill(0x2e7d32); g.drawCircle(0,0,12); g.endFill();
            g.beginFill(0x3e2723); g.drawRect(-2, 0, 4, 10); g.endFill();
            cObjs.addChild(g);
            const id = wi+','+wj;
            trees.set(id, {i:wi,j:wj,node:g});
          }
        }
      }

      const ch = {cx,cy,tiles:cTiles,objs:cObjs,trees};
      state.chunks.set(key, ch);
      chunksEl.textContent = state.chunks.size;
      return ch;
    }

    function unloadFarChunks(){
      // keep only within LOAD_RADIUS from player's chunk
      const {cx,cy} = worldToChunk(state.player.i, state.player.j);
      for(const [key, ch] of state.chunks){
        const dx = Math.abs(ch.cx - cx);
        const dy = Math.abs(ch.cy - cy);
        if(dx>LOAD_RADIUS || dy>LOAD_RADIUS){
          ch.tiles.destroy({children:true}); ch.objs.destroy({children:true});
          state.chunks.delete(key);
        }
      }
      chunksEl.textContent = state.chunks.size;
    }

    function loadAroundPlayer(){
      const {cx,cy} = worldToChunk(state.player.i, state.player.j);
      for(let x=cx-LOAD_RADIUS; x<=cx+LOAD_RADIUS; x++){
        for(let y=cy-LOAD_RADIUS; y<=cy+LOAD_RADIUS; y++){
          ensureChunk(x,y);
        }
      }
      unloadFarChunks();
    }

    // ---- input ----
    const down = new Set();
    function setupInput(){
      window.addEventListener('keydown', e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d','e','i'].includes(k)){ down.add(k); markPad(k,true);} });
      window.addEventListener('keyup',   e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d','e','i'].includes(k)){ down.delete(k); markPad(k,false);} });
      document.querySelectorAll('#pad button').forEach(btn=>{
        const k=btn.dataset.k;
        btn.addEventListener('pointerdown', e=>{ e.preventDefault(); down.add(k); markPad(k,true); });
        btn.addEventListener('pointerup',   e=>{ e.preventDefault(); down.delete(k); markPad(k,false); });
        btn.addEventListener('pointerleave',e=>{ e.preventDefault(); down.delete(k); markPad(k,false); });
      });
    }
    function markPad(k,on){ const el=document.querySelector(`[data-k="${k}"]`); el&&el.classList.toggle('active',on); }

    // ---- interact: chop tree ----
    function tryChop(){
      // find nearest tree in current/neighbor chunks within radius
      const pi = state.player.i, pj = state.player.j;
      const radius = 1.2; // tiles
      const {cx,cy} = worldToChunk(pi,pj);
      for(let x=cx-1;x<=cx+1;x++){
        for(let y=cy-1;y<=cy+1;y++){
          const ch = state.chunks.get(chunkKey(x,y));
          if(!ch) continue;
          for(const [id, t] of ch.trees){
            const d = Math.hypot(t.i - pi, t.j - pj);
            if(d <= radius){
              // remove
              if(t.node.destroy) t.node.destroy();
              ch.trees.delete(id);
              // add wood
              const gained = 1 + ((Math.random()*2)|0); // 1..3
              state.wood += gained; woodEl.textContent = state.wood;
              // float text
              spawnFloat('+Wood '+gained, t.i, t.j, 0xcde8ff);
              return true;
            }
          }
        }
      }
      return false;
    }

    function spawnFloat(text, wi, wj, color){
      const label = new PIXI.Text(text, {fontFamily:'monospace', fontSize:14, fill: color});
      const p = iso(wi,wj);
      label.position.set(p.x, p.y-24);
      label.alpha = 1;
      fxLayer.addChild(label);
      state.floating.push({node:label, vy:-0.2, life:60});
    }

    // ---- camera ----
    function centerCamera(){
      const p=iso(state.player.i,state.player.j);
      const cx=app.renderer.width/2, cy=app.renderer.height/2+80;
      world.position.set(cx - p.x, cy - p.y);
    }

    // ---- main loop ----
    let frames=0,last=performance.now();
    function tick(delta){
      // fps
      frames++; const now=performance.now(); if(now-last>1000){ fpsEl.textContent=frames; frames=0; last=now; }

      // time
      state.timeMinutes += 0.8*delta; const hour=Math.floor((state.timeMinutes/60)%24);
      state.isNight = hour>=20 || hour<6;
      document.getElementById('clock').textContent = (function(min){ let h=Math.floor(min/60)%24, m=Math.floor(min%60); const pad=n=>n<10?'0'+n:n; return pad(h)+':'+pad(m); })(state.timeMinutes);
      document.getElementById('phase').textContent = state.isNight? '(Night)':'(Day)';
      night.alpha += ((state.isNight?0.45:0.0) - night.alpha) * 0.08 * delta;
      nightEl.textContent = state.isNight;

      // needs (placeholder decay)
      state.hunger = Math.max(0, (state.hunger??100) - 0.006 * delta);
      state.thirst = Math.max(0, (state.thirst??100) - 0.009 * delta);
      document.getElementById('health').textContent = (state.health??100).toFixed?.call({},"100") || 100;
      document.getElementById('hunger').textContent = state.hunger.toFixed(0);
      document.getElementById('thirst').textContent = state.thirst.toFixed(0);

      // movement
      let di=0,dj=0; if(down.has('w')) dj-=1; if(down.has('s')) dj+=1; if(down.has('a')) di-=1; if(down.has('d')) di+=1;
      if(di||dj){ const len=Math.hypot(di,dj); di/=len; dj/=len;
        state.player.i += di*state.player.speed*delta; state.player.j += dj*state.player.speed*delta;
      }

      // interact
      if(down.has('e')){ tryChop(); }

      // world streaming
      loadAroundPlayer();

      // draw
      drawPlayer(); centerCamera();
      posEl.textContent = state.player.i.toFixed(2)+','+state.player.j.toFixed(2);

      // floating texts
      for(let i=state.floating.length-1;i>=0;i--){
        const f=state.floating[i];
        f.node.position.y += f.vy*delta;
        f.node.alpha -= 0.015*delta;
        if((f.life-=delta)<=0 || f.node.alpha<=0){
          if(f.node.destroy) f.node.destroy();
          state.floating.splice(i,1);
        }
      }
    }
  }

  // Gate open only after user interaction (Edge-safe)
  function ready(fn){
    if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); }
  }
  ready(run);
})();