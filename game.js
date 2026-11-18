(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mapCanvas = document.getElementById('minimap');
  const mapCtx = mapCanvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const W = canvas.width, H = canvas.height, TILE = 32, COLS = 25, ROWS = 17;
  const OX = (W - COLS * TILE) / 2, OY = (H - ROWS * TILE) / 2;
  const TOTAL_FLOORS = 5;
  const floors = [
    ['INTAKE WING', 'The old service tunnels. Something is dragging its feet.', 'Don’t let it corner you.'],
    ['ARCHIVE LEVEL', 'Paper remembers what people forget.', 'The lights died here first.'],
    ['SUB-BASEMENT', 'The walls are warmer than they should be.', 'You hear breathing in the vents.'],
    ['CONTAINMENT', 'The locks failed from the inside.', 'Keep your distance. It learned to run.'],
    ['THE SIGNAL ROOM', 'It has been calling you by name.', 'This is where it all began.']
  ];
  const state = {mode:'title', floor:0, lives:3, time:0, last:0, keys:{}, muted:true, audio:null, invuln:0, level:null, player:null, enemies:[], shards:[], medkit:null, particles:[], screenShake:0, noteTimer:0, lastFoot:0};
  const wallColors = ['#18201d','#1b211e','#171e1b','#1d2420','#151b19'];
  const floorColors = ['#252a25','#282b25','#292823','#242923','#2a2823'];
  const colorAccent = ['#c5dc73','#d7c18a','#c8d078','#db8c71','#e2c36d'];

  function rand(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;}}
  function key(x,y){return `${x},${y}`;}
  function tileAt(px,py){return {x:Math.floor((px-OX)/TILE),y:Math.floor((py-OY)/TILE)};}
  function center(x,y){return {x:OX+x*TILE+TILE/2,y:OY+y*TILE+TILE/2};}
  function isOpen(x,y){return x>=0&&y>=0&&x<COLS&&y<ROWS&&state.level.grid[y][x]===0;}
  function walkable(px,py,r=8){return [[-r,-r],[r,-r],[-r,r],[r,r],[0,0]].every(([dx,dy])=>{const t=tileAt(px+dx,py+dy);return isOpen(t.x,t.y);});}
  function neighbors(x,y){return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([a,b])=>isOpen(a,b));}
  function bfs(sx,sy){const q=[[sx,sy]], dist=new Map([[key(sx,sy),0]]), prev=new Map();for(let i=0;i<q.length;i++){const [x,y]=q[i];for(const [nx,ny] of neighbors(x,y)){const k=key(nx,ny);if(!dist.has(k)){dist.set(k,dist.get(key(x,y))+1);prev.set(k,key(x,y));q.push([nx,ny]);}}}return{dist,prev};}
  function generateFloor(index){
    const grid=Array.from({length:ROWS},()=>Array(COLS).fill(1)); const random=rand(198607+(index+1)*43091);
    const stack=[[1,1]];grid[1][1]=0;
    while(stack.length){const [x,y]=stack[stack.length-1],opts=[[x+2,y],[x-2,y],[x,y+2],[x,y-2]].filter(([a,b])=>a>0&&b>0&&a<COLS-1&&b<ROWS-1&&grid[b][a]===1);if(!opts.length){stack.pop();continue;}const [nx,ny]=opts[Math.floor(random()*opts.length)];grid[(ny+y)/2][(nx+x)/2]=0;grid[ny][nx]=0;stack.push([nx,ny]);}
    // Small loops keep the maze navigable without making it trivial.
    for(let i=0;i<7+index*2;i++){const x=1+Math.floor(random()*(COLS-2)),y=1+Math.floor(random()*(ROWS-2));if(grid[y][x]===1&&((grid[y][x-1]===0&&grid[y][x+1]===0)||(grid[y-1][x]===0&&grid[y+1][x]===0)))grid[y][x]=0;}
    state.level={grid,seen:Array.from({length:ROWS},()=>Array(COLS).fill(false)),decor:[],doors:[],floor:index};
    const start={x:1,y:1};const {dist,prev}=bfs(start.x,start.y);const far=[...dist.entries()].sort((a,b)=>b[1]-a[1]);
    const goalKey=far[0][0], [gx,gy]=goalKey.split(',').map(Number);state.level.goal={x:gx,y:gy};
    const path=[];let cursor=goalKey;while(cursor){const [x,y]=cursor.split(',').map(Number);path.unshift({x,y});cursor=prev.get(cursor);}
    const shardIndices=[Math.max(3,Math.floor(path.length*.28)),Math.max(5,Math.floor(path.length*.53)),Math.max(7,Math.floor(path.length*.76))];
    const used=new Set([key(start.x,start.y),goalKey]);
    state.shards=shardIndices.map((idx,n)=>{let p=path[Math.min(idx,path.length-2)];if(used.has(key(p.x,p.y)))p=path[Math.min(idx+1,path.length-2)];used.add(key(p.x,p.y));return {...center(p.x,p.y),tx:p.x,ty:p.y,got:false,phase:random()*6.28,n};});
    state.player={...center(start.x,start.y),x: center(start.x,start.y).x,y:center(start.x,start.y).y,dir:{x:1,y:0},walk:0};state.enemies=[];
    const enemySpawns=far.filter(([k,d])=>d>Math.max(10,path.length*.55)).map(([k])=>{const [x,y]=k.split(',').map(Number);return{x,y};});
    for(let e=0;e<Math.min(1+Math.floor(index/2),3);e++){const pos=enemySpawns[Math.floor(random()*enemySpawns.length)]||{x:gx-1,y:gy};const c=center(pos.x,pos.y);state.enemies.push({x:c.x,y:c.y,tx:pos.x,ty:pos.y,path:[],repath:random(),speed:50+index*8+e*5,phase:random()*5,stun:0});}
    state.medkit=null;if(index<4&&state.lives<3&&random()>.32){const options=far.filter(([k,d])=>d>7&&!used.has(k));const pick=options[Math.floor(random()*options.length)];if(pick){const [x,y]=pick[0].split(',').map(Number);state.medkit={...center(x,y),tx:x,ty:y,got:false,phase:random()*6};}}
    for(let y=1;y<ROWS-1;y++)for(let x=1;x<COLS-1;x++){if(grid[y][x]===0&&random()<.12){state.level.decor.push({x,y,type:Math.floor(random()*5),rot:Math.floor(random()*4)});}}
    state.invuln=1.5;state.particles=[];state.noteTimer=0;
    updateHUD();
  }
  function updateHUD(){
    const floor=String(state.floor+1).padStart(2,'0');$('floor-label').textContent=`FLOOR ${floor} / 05`;$('floor-stat').innerHTML=`${floor} <small>/ 05</small>`;$('footer-floor').textContent=floor;
    const relayRestored=!!state.shards?.length&&state.shards.every(s=>s.got);
    $('objective-title').textContent=relayRestored?'Reach the exit':'Restore the relay';
    $('objective-copy').textContent=relayRestored?'The lock is open. Find the marked door.':'Collect the signal shards. Find the exit.';
    const count=state.shards?state.shards.filter(s=>s.got).length:0;$('signal-count').textContent=`${count} / 3`;$('progress-fill').style.width=`${count/3*100}%`;
    document.querySelectorAll('.shard').forEach((el,i)=>el.classList.toggle('collected',!!state.shards?.[i]?.got));
    const hearts=$('hearts');hearts.innerHTML=Array.from({length:3},(_,i)=>`<span class="${i>=state.lives?'lost':''}">♥</span>`).join('');hearts.setAttribute('aria-label',`${state.lives} lives`);
    $('tip-text').innerHTML=`<b>FIELD NOTE</b> ${floors[state.floor]?.[2]||'Stay alert.'}`;$('map-label').style.display=state.mode==='title'?'grid':'none';
  }
  function startGame(){state.mode='playing';state.floor=0;state.lives=3;state.time=0;state.invuln=1.8;generateFloor(0);$('start-overlay').classList.add('hidden');$('end-overlay').classList.add('hidden');$('pause-overlay').classList.add('hidden');$('map-label').style.display='none';$('status-text').textContent='SIGNAL LOST · 00:00';state.last=performance.now();}
  function pauseGame(){if(state.mode==='playing'){state.mode='paused';$('pause-overlay').classList.remove('hidden');}else if(state.mode==='paused'){state.mode='playing';$('pause-overlay').classList.add('hidden');state.last=performance.now();}}
  function setEnd(won){state.mode='ended';$('end-overlay').classList.remove('hidden');$('end-overlay').classList.toggle('danger',!won);$('end-symbol').textContent=won?'✳':'✕';$('end-kicker').textContent=won?'SIGNAL RESTORED':'CONNECTION LOST';$('end-title').textContent=won?'YOU MADE IT.':'IT FOUND YOU.';$('end-copy').textContent=won?'The first light of dawn spills across the road.':'The halls fall quiet. They always do.';$('map-label').style.display='grid';}
  function nextFloor(){state.floor++;if(state.floor>=TOTAL_FLOORS){setEnd(true);return;}if(state.floor%2===0&&state.lives<3)state.lives++;generateFloor(state.floor);$('status-text').textContent=`SIGNAL LOST · ${formatTime(state.time)}`;}
  function formatTime(s){const sec=Math.floor(s);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
  function sound(freq=440,duration=.12,type='sine'){if(state.muted)return;try{state.audio??=new(window.AudioContext||window.webkitAudioContext)();const a=state.audio,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.055,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+duration);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+duration);}catch{}}
  function addBurst(x,y,color,n=8){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=20+Math.random()*65;state.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.45+Math.random()*.4,color});}}
  function collectShard(s){s.got=true;addBurst(s.x,s.y,colorAccent[state.floor],15);sound(660,.25,'triangle');updateHUD();if(state.shards.every(v=>v.got)){state.noteTimer=2.5;}}
  function collideEnemy(enemy){if(state.invuln>0||enemy.stun>0)return;state.lives--;state.invuln=2;state.screenShake=.25;enemy.stun=1.2;addBurst(state.player.x,state.player.y,'#e56b60',14);sound(100,.3,'sawtooth');canvas.parentElement.classList.remove('hit');void canvas.parentElement.offsetWidth;canvas.parentElement.classList.add('hit');updateHUD();if(state.lives<=0)setEnd(false);else{const c=center(1,1);state.player.x=c.x;state.player.y=c.y;}}

  function update(dt){
    if(state.mode!=='playing')return;
    state.time+=dt;state.invuln=Math.max(0,state.invuln-dt);state.screenShake=Math.max(0,state.screenShake-dt);state.noteTimer=Math.max(0,state.noteTimer-dt);
    $('time-stat').textContent=formatTime(state.time);$('status-text').textContent=`SIGNAL LOST · ${formatTime(state.time)}`;
    const p=state.player;let dx=0,dy=0;if(state.keys.ArrowLeft||state.keys.a)dx--;if(state.keys.ArrowRight||state.keys.d)dx++;if(state.keys.ArrowUp||state.keys.w)dy--;if(state.keys.ArrowDown||state.keys.s)dy++;const mag=Math.hypot(dx,dy)||1;dx/=mag;dy/=mag;
    if(dx||dy){p.dir={x:dx,y:dy};p.walk+=dt*10;const speed=145;const nx=p.x+dx*speed*dt,ny=p.y+dy*speed*dt;if(walkable(nx,p.y,8))p.x=nx;if(walkable(p.x,ny,8))p.y=ny;if(state.time-state.lastFoot>.34){state.lastFoot=state.time;if(state.floor>1)sound(75,.035,'sine');}}
    const pt=tileAt(p.x,p.y);for(let y=Math.max(0,pt.y-5);y<=Math.min(ROWS-1,pt.y+5);y++)for(let x=Math.max(0,pt.x-5);x<=Math.min(COLS-1,pt.x+5);x++)if(Math.hypot(x-pt.x,y-pt.y)<5.4)state.level.seen[y][x]=true;
    for(const s of state.shards){s.phase+=dt*2;if(!s.got&&Math.hypot(s.x-p.x,s.y-p.y)<17)collectShard(s);}
    if(state.medkit){state.medkit.phase+=dt*2;if(!state.medkit.got&&state.lives<3&&Math.hypot(state.medkit.x-p.x,state.medkit.y-p.y)<17){state.medkit.got=true;state.lives=Math.min(3,state.lives+1);addBurst(state.medkit.x,state.medkit.y,'#a5e0b0',12);sound(520,.22,'triangle');updateHUD();}}
    for(const e of state.enemies){e.phase+=dt*3;e.stun=Math.max(0,e.stun-dt);e.repath-=dt;if(e.repath<=0){const et=tileAt(e.x,e.y);const target=tileAt(p.x,p.y);const {prev}=bfs(target.x,target.y);let k=key(et.x,et.y),route=[];let guard=0;while(k&&k!==key(target.x,target.y)&&guard++<COLS*ROWS){const [x,y]=k.split(',').map(Number);route.push({x,y});k=prev.get(k);}route.reverse();e.path=route;e.repath=.35+Math.random()*.15;}
      if(e.stun<=0&&e.path.length){const next=e.path[0],dest=center(next.x,next.y),vx=dest.x-e.x,vy=dest.y-e.y,len=Math.hypot(vx,vy),step=e.speed*dt;if(len<step+1){e.x=dest.x;e.y=dest.y;e.tx=next.x;e.ty=next.y;e.path.shift();}else{e.x+=vx/len*step;e.y+=vy/len*step;}}
      if(Math.hypot(e.x-p.x,e.y-p.y)<19)collideEnemy(e);
    }
    const goal=state.level.goal;if(state.shards.every(s=>s.got)&&Math.hypot(p.x-center(goal.x,goal.y).x,p.y-center(goal.x,goal.y).y)<18){sound(800,.35,'triangle');nextFloor();}
    for(const q of state.particles){q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=.96;q.vy*=.96;q.life-=dt;}state.particles=state.particles.filter(q=>q.life>0);
  }
  function rounded(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function drawWorld(){
    ctx.fillStyle='#080b0a';ctx.fillRect(0,0,W,H);if(!state.level){drawTitleScene();return;}
    const shake=state.screenShake?Math.random()*state.screenShake*12:0;ctx.save();ctx.translate(shake,0);
    // Walls and floor
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const px=OX+x*TILE,py=OY+y*TILE;if(state.level.grid[y][x]){ctx.fillStyle=wallColors[(x*13+y*7+state.floor)%wallColors.length];ctx.fillRect(px,py,TILE,TILE);ctx.fillStyle='#303732';ctx.fillRect(px+1,py+1,TILE-2,2);ctx.fillStyle='#111715';ctx.fillRect(px+1,py+TILE-3,TILE-2,2);if((x+y)%3===0){ctx.fillStyle='#222b27';ctx.fillRect(px+5,py+8,8,1);ctx.fillRect(px+19,py+14,9,1);}if(state.level.grid[y+1]&&state.level.grid[y+1][x]===0){ctx.fillStyle='#252d28';ctx.fillRect(px,py+TILE-2,TILE,2);}}
      else{ctx.fillStyle=floorColors[(x*5+y*3+state.floor)%floorColors.length];ctx.fillRect(px,py,TILE,TILE);if((x*7+y*11)%9===0){ctx.fillStyle='#34342d';ctx.globalAlpha=.35;ctx.fillRect(px+5+(x%3)*6,py+9+(y%3)*4,7,1);ctx.globalAlpha=1;}if((x*9+y*7)%17===0){ctx.strokeStyle='#181e1a';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px+9,py+22);ctx.lineTo(px+13,py+16);ctx.lineTo(px+17,py+20);ctx.stroke();}}
    }
    // Scattered room objects
    for(const d of state.level.decor){const c=center(d.x,d.y),px=c.x,py=c.y;if(Math.hypot(px-state.player.x,py-state.player.y)>240)continue;ctx.save();ctx.translate(px,py);ctx.rotate(d.rot*Math.PI/2);if(d.type===0){rounded(-11,-7,22,14,2,'#403c30');ctx.fillStyle='#625943';ctx.fillRect(-8,-5,15,2);ctx.fillStyle='#1b211d';ctx.fillRect(7,-2,2,7);}else if(d.type===1){ctx.fillStyle='#45423a';ctx.beginPath();ctx.moveTo(-8,7);ctx.lineTo(-4,-7);ctx.lineTo(0,6);ctx.lineTo(4,-5);ctx.lineTo(9,8);ctx.fill();}else if(d.type===2){ctx.strokeStyle='#6b5144';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-10,-5);ctx.lineTo(-3,6);ctx.lineTo(3,-7);ctx.lineTo(9,4);ctx.stroke();}else if(d.type===3){ctx.fillStyle='#4b4d43';ctx.fillRect(-8,-8,16,16);ctx.fillStyle='#202722';ctx.fillRect(-5,-5,10,10);ctx.fillStyle='#ad604e';ctx.fillRect(-2,-4,4,8);}else{ctx.fillStyle='#88806a';ctx.fillRect(-8,-2,16,4);ctx.fillRect(-5,-5,3,10);ctx.fillRect(2,-5,3,10);}ctx.restore();}
    const goal=state.level.goal,gc=center(goal.x,goal.y),open=state.shards.every(s=>s.got);ctx.save();ctx.translate(gc.x,gc.y);ctx.fillStyle=open?'#e4cb74':'#5b6351';ctx.shadowColor=open?'#f6d874':'transparent';ctx.shadowBlur=open?18:0;ctx.fillRect(-12,-14,24,28);ctx.shadowBlur=0;ctx.fillStyle='#1a201b';ctx.fillRect(-8,-11,16,23);ctx.fillStyle=open?'#e7d079':'#777c68';ctx.fillRect(4,-1,2,2);if(open){ctx.strokeStyle='#dac56f';ctx.lineWidth=1;ctx.strokeRect(-15,-17,30,34);}ctx.restore();
    for(const s of state.shards){if(s.got)continue;const glow=8+Math.sin(s.phase)*3;ctx.save();ctx.translate(s.x,s.y-4);ctx.rotate(Math.PI/4+Math.sin(s.phase)*.1);ctx.shadowColor=colorAccent[state.floor];ctx.shadowBlur=glow;ctx.fillStyle=colorAccent[state.floor];ctx.fillRect(-5,-5,10,10);ctx.fillStyle='#f6f7d0';ctx.fillRect(-2,-2,4,4);ctx.restore();}
    if(state.medkit&&!state.medkit.got){const m=state.medkit;ctx.save();ctx.translate(m.x,m.y+Math.sin(m.phase)*2);ctx.shadowColor='#9bdbb3';ctx.shadowBlur=12;rounded(-8,-7,16,14,2,'#9bdbb3');ctx.shadowBlur=0;ctx.fillStyle='#29352c';ctx.fillRect(-1,-5,2,10);ctx.fillRect(-5,-1,10,2);ctx.restore();}
    for(const e of state.enemies)drawEnemy(e);
    drawPlayer(state.player);
    for(const q of state.particles){ctx.globalAlpha=Math.max(0,q.life);ctx.fillStyle=q.color;ctx.fillRect(q.x-2,q.y-2,4,4);}ctx.globalAlpha=1;
    // The flashlight cone cuts through the darkness.
    const p=state.player,lightRadius=state.floor>2?132:158;ctx.save();ctx.globalCompositeOperation='destination-in';const gradient=ctx.createRadialGradient(p.x,p.y,25,p.x,p.y,lightRadius);gradient.addColorStop(0,'rgba(255,255,255,.98)');gradient.addColorStop(.52,'rgba(255,255,255,.85)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);ctx.restore();
    // Persistent dark overlay plus a warm pool of flashlight light.
    ctx.fillStyle='rgba(2,5,4,.72)';ctx.fillRect(0,0,W,H);const beam=ctx.createRadialGradient(p.x,p.y,12,p.x,p.y,lightRadius);beam.addColorStop(0,'rgba(218,228,175,.22)');beam.addColorStop(.62,'rgba(179,197,135,.11)');beam.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=beam;ctx.fillRect(0,0,W,H);
    const danger=Math.min(1,Math.max(0,...state.enemies.map(e=>1-Math.hypot(e.x-p.x,e.y-p.y)/220)));if(danger>.05){const red=ctx.createRadialGradient(p.x,p.y,55,p.x,p.y,270);red.addColorStop(0,'rgba(128,18,14,0)');red.addColorStop(1,`rgba(147,24,18,${danger*.2})`);ctx.fillStyle=red;ctx.fillRect(0,0,W,H);}
    if(state.noteTimer>0){ctx.textAlign='center';ctx.font='11px DM Mono, monospace';ctx.fillStyle='#e2edaa';ctx.fillText('THE EXIT IS OPEN — KEEP MOVING',W/2,H-43);}
    ctx.restore();
  }
  function drawTitleScene(){
    const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#101715');bg.addColorStop(1,'#080b0a');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    for(let y=0;y<7;y++)for(let x=0;x<13;x++){const px=85+x*62,py=26+y*81;ctx.fillStyle=(x+y)%2?'#1a211e':'#171e1b';ctx.fillRect(px,py,58,77);ctx.fillStyle='#242c27';ctx.fillRect(px+2,py+2,54,3);ctx.fillStyle='#101513';ctx.fillRect(px+5,py+12,1,57);if((x+y)%4===0){ctx.fillStyle='#33362e';ctx.fillRect(px+14,py+26,26,2);}}
    // Distant corridor and a flickering warning light.
    ctx.fillStyle='#0b100e';ctx.fillRect(356,102,248,430);ctx.fillStyle='#1c2420';ctx.fillRect(348,100,14,438);ctx.fillRect(598,100,14,438);ctx.fillStyle='#242a24';ctx.fillRect(360,108,239,8);ctx.fillStyle='#be544a';ctx.shadowColor='#d35b4e';ctx.shadowBlur=22;ctx.fillRect(472,139,15,4);ctx.shadowBlur=0;
    ctx.fillStyle='#111715';ctx.fillRect(422,318,117,214);ctx.strokeStyle='#313a32';ctx.strokeRect(422,318,117,214);ctx.fillStyle='#171d19';ctx.fillRect(431,327,99,205);ctx.fillStyle='#858e74';ctx.fillRect(519,425,5,5);
    for(let i=0;i<5;i++){ctx.strokeStyle=`rgba(157,171,120,${.06-i*.009})`;ctx.beginPath();ctx.ellipse(480,528,45+i*54,15+i*44,0,Math.PI,Math.PI*2);ctx.stroke();}
    ctx.fillStyle='#060908';ctx.fillRect(0,0,W,H);const g=ctx.createRadialGradient(480,357,80,480,357,420);g.addColorStop(0,'rgba(113,131,82,.12)');g.addColorStop(1,'rgba(0,0,0,.4)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  }
  function drawPlayer(p){
    if(state.invuln>0&&Math.floor(state.invuln*12)%2===0)return;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.dir.y,p.dir.x));const step=Math.sin(p.walk)*1.6;
    ctx.fillStyle='#111714';ctx.beginPath();ctx.ellipse(0,8,10,6,0,0,Math.PI*2);ctx.fill();
    // Small survivor sprite: coat, head, backpack and flashlight.
    rounded(-7,-8,14,18,3,'#9b9e83');ctx.fillStyle='#d3c7a2';ctx.beginPath();ctx.arc(4,-1,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#453f31';ctx.fillRect(1,-8,8,3);ctx.fillStyle='#505c4a';ctx.fillRect(-9,-5,4,10);ctx.fillStyle='#d6e296';ctx.fillRect(7,-3,5,3);ctx.fillStyle='#f4ecbe';ctx.fillRect(11,-4,2,5);ctx.fillStyle='#333d33';ctx.fillRect(-4,8+step,4,4);ctx.fillRect(2,8-step,4,4);ctx.restore();
  }
  function drawEnemy(e){
    ctx.save();ctx.translate(e.x,e.y+Math.sin(e.phase)*2);const pulse=1+Math.sin(e.phase*1.4)*.06;ctx.scale(pulse,1/pulse);
    ctx.fillStyle='#090d0b';ctx.beginPath();ctx.ellipse(0,7,13,9,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=e.stun>0?'#423936':'#343b34';ctx.beginPath();ctx.moveTo(-10,7);ctx.quadraticCurveTo(-15,-7,-8,-14);ctx.quadraticCurveTo(0,-22,9,-14);ctx.quadraticCurveTo(16,-4,10,8);ctx.quadraticCurveTo(2,14,-10,7);ctx.fill();ctx.fillStyle='#a94d43';ctx.shadowColor='#e45b4e';ctx.shadowBlur=8;ctx.fillRect(-5,-11,3,2);ctx.fillRect(3,-11,3,2);ctx.shadowBlur=0;ctx.strokeStyle='#111411';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-4,-3);ctx.lineTo(5,-3);ctx.stroke();ctx.restore();
  }
  function drawMinimap(){
    const w=mapCanvas.width,h=mapCanvas.height;mapCtx.fillStyle='#0a100d';mapCtx.fillRect(0,0,w,h);if(!state.level)return;const sx=w/COLS,sy=h/ROWS;
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){if(!state.level.seen[y][x])continue;mapCtx.fillStyle=state.level.grid[y][x]?'#303a32':'#768477';mapCtx.fillRect(x*sx,y*sy,Math.ceil(sx),Math.ceil(sy));}
    const goal=state.level.goal;if(state.level.seen[goal.y][goal.x]){mapCtx.fillStyle='#eed06d';mapCtx.fillRect((goal.x+.25)*sx,(goal.y+.25)*sy,sx*.5,sy*.5);}
    for(const e of state.enemies){const t=tileAt(e.x,e.y);if(t.x>=0&&t.y>=0&&t.x<COLS&&t.y<ROWS&&state.level.seen[t.y][t.x]){mapCtx.fillStyle='#e47765';mapCtx.beginPath();mapCtx.arc((t.x+.5)*sx,(t.y+.5)*sy,2.4,0,Math.PI*2);mapCtx.fill();}}
    const p=tileAt(state.player.x,state.player.y);mapCtx.fillStyle='#e5f58f';mapCtx.beginPath();mapCtx.arc((p.x+.5)*sx,(p.y+.5)*sy,3,0,Math.PI*2);mapCtx.fill();
  }
  function frame(now){const dt=Math.min(.05,(now-state.last)/1000||0);state.last=now;update(dt);drawWorld();drawMinimap();requestAnimationFrame(frame);}

  document.addEventListener('keydown',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(k))e.preventDefault();if(k==='Escape'){pauseGame();return;}state.keys[k]=true;if(state.mode==='title'&&(k==='Enter'||k===' '))startGame();if(state.mode==='paused'&&k==='Enter')pauseGame();});
  document.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;state.keys[k]=false;});window.addEventListener('blur',()=>{state.keys={};if(state.mode==='playing')pauseGame();});
  $('start-button').addEventListener('click',startGame);$('resume-button').addEventListener('click',pauseGame);$('restart-button').addEventListener('click',startGame);
  $('sound-button').addEventListener('click',()=>{state.muted=!state.muted;$('sound-icon').textContent=state.muted?'♪':'♫';document.querySelector('.sound-label').textContent=state.muted?'SOUND OFF':'SOUND ON';if(!state.muted)sound(440,.1);});
  document.querySelectorAll('.touch-controls button').forEach(button=>{const press=e=>{e.preventDefault();const d=button.dataset.dir;state.keys[{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[d]]=true;};const release=e=>{e.preventDefault();const d=button.dataset.dir;state.keys[{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[d]]=false;};button.addEventListener('pointerdown',press);button.addEventListener('pointerup',release);button.addEventListener('pointerleave',release);button.addEventListener('pointercancel',release);});
  updateHUD();drawWorld();drawMinimap();requestAnimationFrame(frame);
})();
