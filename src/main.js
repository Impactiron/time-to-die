(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  function resize(){
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const $=(id)=>document.getElementById(id);
  const TILE_W=64, TILE_H=32, WORLD_W=40, WORLD_H=40;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const fmtClock=(min)=>{ let h=Math.floor(min/60)%24, m=Math.floor(min%60); const pad=n=>n<10?'0'+n:n; return pad(h)+':'+pad(m); };
  const isoToScreen=(i,j)=>({x:(i-j)*(TILE_W/2), y:(i+j)*(TILE_H/2)});

  const state={ player:{i:20,j:20,speed:6/60,health:100,hunger:100,thirst:100},
    timeMinutes:12*60,isNight:false, crates:[], zombies:[] };

  // create ground once
  const ground = [];
  for(let i=0;i<WORLD_W;i++){
    for(let j=0;j<WORLD_H;j++){
      const p=isoToScreen(i,j);
      const color = ((i+j)%2===0) ? '#1b232b' : '#1f2831';
      ground.push({x:p.x,y:p.y,color});
    }
  }

  // spawn crates/zombies
  function spawnCrate(i,j,type){
    const p=isoToScreen(i,j); state.crates.push({i,j,type,pos:p});
  }
  spawnCrate(18,20,'wood'); spawnCrate(22,19,'food'); spawnCrate(21,22,'water');
  function spawnZombie(i,j){
    const p=isoToScreen(i,j); state.zombies.push({i,j,speed:3/60,pos:p});
  }
  spawnZombie(25,25); spawnZombie(15,27);

  // input
  const down=new Set();
  const diagKeys=['w','a','s','d','e','b','q','i'];
  const keyEl={w:$('#kW'),a:$('#kA'),s:$('#kS'),d:$('#kD'),e:$('#kE'),b:$('#kB'),q:$('#kQ'),i:$('#kI')};
  function mark(k,on){ if(keyEl[k]) keyEl[k].classList.toggle('active',on); }
  function setKey(k,on){ if(diagKeys.includes(k)) mark(k,on); if(on) down.add(k); else down.delete(k); }
  window.addEventListener('keydown', (e)=>{ const k=e.key.toLowerCase(); if(k==='f5'||k==='f9') e.preventDefault(); setKey(k,true); toastHide(); canvas.focus(); });
  window.addEventListener('keyup', (e)=> setKey(e.key.toLowerCase(),false));
  canvas.addEventListener('pointerdown', ()=>{ canvas.focus(); toastHide(); });
  const pad=document.getElementById('pad');
  pad.querySelectorAll('button').forEach(btn=>{
    const k=btn.getAttribute('data-k');
    btn.addEventListener('pointerdown', (e)=>{ e.preventDefault(); setKey(k,true); btn.classList.add('active'); canvas.focus(); });
    btn.addEventListener('pointerup',   (e)=>{ e.preventDefault(); setKey(k,false); btn.classList.remove('active'); });
    btn.addEventListener('pointerleave',(e)=>{ e.preventDefault(); setKey(k,false); btn.classList.remove('active'); });
  });
  function toastHide(){ const t=$('#toast'); if(t) t.style.display='none'; }

  function drawDiamond(x,y,w,h,fill){
    ctx.beginPath();
    ctx.moveTo(x, y - h/2);
    ctx.lineTo(x + w/2, y);
    ctx.lineTo(x, y + h/2);
    ctx.lineTo(x - w/2, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawRoundedRect(x,y,w,h,r,fill){
    // Fallback ohne ctx.roundRect (breit kompatibel)
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
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function gameLoop(tPrev){
    let last=tPrev||performance.now(), frames=0, lastFPS=performance.now();

    function frame(now){
      const delta = Math.max(0.0001,(now-last)/16.6667); // 60fps normed
      last = now; frames++;
      if(now - lastFPS > 1000){ $('#fps').textContent = frames; frames=0; lastFPS=now; }

      // time
      state.timeMinutes += 0.8 * delta;
      const hour = Math.floor((state.timeMinutes/60)%24);
      state.isNight = (hour>=20 || hour<6);
      $('#clock').textContent = fmtClock(state.timeMinutes);
      $('#phase').textContent = state.isNight? '(Night)' : '(Day)';
      $('#isNight').textContent = state.isNight;

      // needs
      state.hunger = Math.max(0, state.hunger - 0.006 * delta);
      state.thirst = Math.max(0, state.thirst - 0.009 * delta);
      if(state.hunger===0) state.player.health = Math.max(0, state.player.health - 0.03*delta);
      if(state.thirst===0) state.player.health = Math.max(0, state.player.health - 0.05*delta);
      $('#health').textContent = state.player.health.toFixed(0);
      $('#hunger').textContent = state.hunger.toFixed(0);
      $('#thirst').textContent = state.thirst.toFixed(0);

      // movement
      let di=0,dj=0; if(down.has('w')) dj-=1; if(down.has('s')) dj+=1; if(down.has('a')) di-=1; if(down.has('d')) di+=1;
      if(di||dj){ const len=Math.hypot(di,dj); di/=len; dj/=len;
        state.player.i = Math.max(1, Math.min(WORLD_W-2, state.player.i + di * state.player.speed * delta));
        state.player.j = Math.max(1, Math.min(WORLD_H-2, state.player.j + dj * state.player.speed * delta));
      }

      // camera center
      const p = isoToScreen(state.player.i, state.player.j);
      const cx = canvas.width/2, cy = canvas.height/2 + 80;
      const offx = cx - p.x, offy = cy - p.y;

      // clear
      ctx.clearRect(0,0,canvas.width,canvas.height);

      // ground
      for(const tile of ground){
        drawDiamond(tile.x + offx, tile.y + offy, TILE_W, TILE_H, tile.color);
      }

      // crates
      for(const c of state.crates){
        const px = c.pos.x + offx, py = c.pos.y + offy - 8;
        drawRoundedRect(px-12, py-12, 24, 24, 3, (c.type==='water') ? '#3b82f6' : (c.type==='food') ? '#b86b00' : '#8b5a2b');
        // cross lines
        ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(px-12,py); ctx.lineTo(px+12,py); ctx.moveTo(px,py-12); ctx.lineTo(px,py+12); ctx.stroke();
      }

      // zombies
      for(const z of state.zombies){
        const targetI = state.isNight ? state.player.i : z.i + (Math.random()-0.5)*0.02*delta;
        const targetJ = state.isNight ? state.player.j : z.j + (Math.random()-0.5)*0.02*delta;
        const vI = targetI - z.i, vJ = targetJ - z.j; const d = Math.hypot(vI,vJ)||1;
        z.i += (vI/d) * z.speed * delta; z.j += (vJ/d) * z.speed * delta;
        const pz = isoToScreen(z.i,z.j);
        const zx = pz.x + offx, zy = pz.y + offy - 8;
        ctx.fillStyle = '#a6e22e'; ctx.beginPath(); ctx.arc(zx,zy,9,0,Math.PI*2); ctx.fill();
      }

      // player
      const px = p.x + offx, py = p.y + offy - 10;
      // shadow
      ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py+10, 12, 4, 0, Math.PI*2); ctx.fill();
      // body
      ctx.fillStyle='#9ad1ff'; ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI*2); ctx.fill();

      // night overlay
      if(state.isNight){
        ctx.fillStyle='rgba(0,0,16,0.45)';
        ctx.fillRect(0,0,canvas.width,canvas.height);
      }

      // diag pos
      $('#pos').textContent = state.player.i.toFixed(2)+','+state.player.j.toFixed(2);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  gameLoop();
})();