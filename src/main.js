(function(){
  function showErr(msg){
    const el=document.getElementById('err');
    el.classList.remove('hidden'); el.textContent = '⚠️ '+msg;
  }

  function run(){
    if(!window.PIXI){ showErr('PIXI nicht geladen (CDN blockiert?)'); return; }

    const canvas = document.getElementById('game');
    const app = new PIXI.Application({
      view: canvas, resizeTo: window, antialias: true, backgroundColor: 0x0b0d10
    });

    const $ = (id)=>document.getElementById(id);
    const TILE_W=64, TILE_H=32, WORLD_W=40, WORLD_H=40;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const fmtClock=(min)=>{ let h=Math.floor(min/60)%24, m=Math.floor(min%60); const pad=n=>n<10?'0'+n:n; return pad(h)+':'+pad(m); };
    const iso=(i,j)=>({x:(i-j)*(TILE_W/2), y:(i+j)*(TILE_H/2)});

    const state={ player:{i:20,j:20,speed:6/60,health:100,hunger:100,thirst:100},
      timeMinutes:12*60,isNight:false, crates:[], zombies:[] };

    const world=new PIXI.Container();
    const ground=new PIXI.Container(), actors=new PIXI.Container(), fx=new PIXI.Container();
    world.addChild(ground,actors,fx); app.stage.addChild(world);

    function diamond(g,w,h,color){
      g.beginFill(color); g.moveTo(0,-h/2); g.lineTo(w/2,0); g.lineTo(0,h/2); g.lineTo(-w/2,0); g.closePath(); g.endFill();
    }
    for(let i=0;i<WORLD_W;i++) for(let j=0;j<WORLD_H;j++){
      const g=new PIXI.Graphics(); const p=iso(i,j); g.position.set(p.x,p.y);
      diamond(g,TILE_W,TILE_H,(i+j)%2===0?0x1b232b:0x1f2831); ground.addChild(g);
    }

    const player=new PIXI.Graphics(); actors.addChild(player);
    function drawPlayer(){ player.clear(); const p=iso(state.player.i,state.player.j); player.position.set(p.x,p.y-10);
      player.beginFill(0x9ad1ff); player.drawCircle(0,0,10); player.endFill();
      player.beginFill(0x000000,0.3); player.drawEllipse(0,10,12,4); player.endFill(); }
    drawPlayer();

    function crate(i,j,type){ const g=new PIXI.Graphics(); const p=iso(i,j); g.position.set(p.x,p.y-8);
      let color=0x8b5a2b; if(type==='food')color=0xb86b00; if(type==='water')color=0x3b82f6;
      g.beginFill(color); g.drawRoundedRect(-12,-12,24,24,3); g.endFill();
      g.lineStyle(2,0x000000,0.35).moveTo(-12,0).lineTo(12,0).moveTo(0,-12).lineTo(0,12); actors.addChild(g); }
    crate(18,20,'wood'); crate(22,19,'food'); crate(21,22,'water');

    const zombies=[];
    function spawnZombie(i,j){ const g=new PIXI.Graphics(); const p=iso(i,j); g.position.set(p.x,p.y-8);
      g.beginFill(0xa6e22e); g.drawCircle(0,0,9); g.endFill(); actors.addChild(g); zombies.push({i,j,speed:3/60,node:g}); }
    spawnZombie(25,25); spawnZombie(15,27);

    const night=new PIXI.Graphics(); night.beginFill(0x000010,0.0); night.drawRect(-5000,-5000,10000,10000); night.endFill(); fx.addChild(night);

    const down=new Set(); const mark=(k,on)=>{ const el=document.querySelector(`[data-k="${k}"]`); el&&el.classList.toggle('active',on); };
    window.addEventListener('keydown', e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d'].includes(k)){ down.add(k); mark(k,true); }});
    window.addEventListener('keyup',   e=>{ const k=e.key.toLowerCase(); if(['w','a','s','d'].includes(k)){ down.delete(k); mark(k,false);} });
    document.querySelectorAll('#pad button').forEach(btn=>{
      const k=btn.dataset.k; btn.addEventListener('pointerdown', e=>{ e.preventDefault(); down.add(k); mark(k,true); });
      btn.addEventListener('pointerup',   e=>{ e.preventDefault(); down.delete(k); mark(k,false); });
      btn.addEventListener('pointerleave',e=>{ e.preventDefault(); down.delete(k); mark(k,false); });
    });

    function center(){ const p=iso(state.player.i,state.player.j); const cx=app.renderer.width/2, cy=app.renderer.height/2+80; world.position.set(cx - p.x, cy - p.y); }

    let frames=0,last=performance.now();
    app.ticker.add((delta)=>{
      frames++; const now=performance.now(); if(now-last>1000){ document.getElementById('fps').textContent=frames; frames=0; last=now; }

      state.timeMinutes += 0.8*delta; const hour=Math.floor((state.timeMinutes/60)%24);
      state.isNight = hour>=20 || hour<6;
      document.getElementById('clock').textContent = fmtClock(state.timeMinutes);
      document.getElementById('phase').textContent = state.isNight? '(Night)':'(Day)';
      night.alpha += ((state.isNight?0.45:0.0) - night.alpha) * 0.08 * delta;
      document.getElementById('isNight').textContent = state.isNight;

      state.hunger = Math.max(0, state.hunger - 0.006 * delta);
      state.thirst = Math.max(0, state.thirst - 0.009 * delta);
      document.getElementById('health').textContent = state.player.health.toFixed(0);
      document.getElementById('hunger').textContent = state.hunger.toFixed(0);
      document.getElementById('thirst').textContent = state.thirst.toFixed(0);

      let di=0,dj=0; if(down.has('w')) dj-=1; if(down.has('s')) dj+=1; if(down.has('a')) di-=1; if(down.has('d')) di+=1;
      if(di||dj){ const len=Math.hypot(di,dj); di/=len; dj/=len; state.player.i = clamp(state.player.i + di*state.player.speed*delta, 1, WORLD_W-2); state.player.j = clamp(state.player.j + dj*state.player.speed*delta, 1, WORLD_H-2); drawPlayer(); }
      center();

      for(const z of zombies){
        const ti = state.isNight ? state.player.i : z.i + (Math.random()-0.5)*0.02*delta;
        const tj = state.isNight ? state.player.j : z.j + (Math.random()-0.5)*0.02*delta;
        const vi=ti-z.i, vj=tj-z.j, d=Math.hypot(vi,vj)||1;
        z.i += (vi/d)*z.speed*delta; z.j += (vj/d)*z.speed*delta;
        const p=iso(z.i,z.j); z.node.position.set(p.x,p.y-8);
      }

      document.getElementById('pos').textContent = state.player.i.toFixed(2)+','+state.player.j.toFixed(2);
    });

    center();
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', run); } else { run(); }
})();