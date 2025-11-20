// MAIN GAME SCRIPT
(() => {
  // ----- Config -----
  const GRID = 3;
  const CAMERA_DISTANCE = 6;
  const CAMERA_HEIGHT = 2;
  const PLAYER_HEIGHT = 1.6;
  const MOVE_SPEED = 0.12;
  const JUMP_VELOCITY = 0.28;
  const GRAVITY = -0.015;
  const BULLET_SPEED = 1.2;

  // ----- Scene / Renderer -----
  const canvas = document.getElementById('threeCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio ? window.devicePixelRatio : 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.rotation.order = "YXZ";

  // lights
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 8);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  // ground
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3c3c3c });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ----- Player -----
  const player = new THREE.Object3D();
  player.position.set(0, PLAYER_HEIGHT, 5);
  scene.add(player);

  // visual body (for debugging / simple avatar)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.2, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x00ffc8 })
  );
  body.position.y = -0.9;
  player.add(body);

  // ----- Controls state -----
  const keys = {};
  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  document.body.addEventListener('click', () => {
    if (document.pointerLockElement !== document.body) {
      document.body.requestPointerLock();
    }
  });

  // ----- Mouse look (yaw/pitch) -----
  let camYaw = 0;
  let camPitch = 0;
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === document.body) {
      camYaw -= e.movementX * 0.0025;
      camPitch -= e.movementY * 0.0025;
      camPitch = Math.max(-0.9, Math.min(0.9, camPitch));
    }
  });

  // ----- Camera follow (use yaw/pitch directly) -----
  function updateCamera() {
    // compute offset in spherical coordinates
    const offsetX = Math.sin(camYaw) * CAMERA_DISTANCE;
    const offsetZ = Math.cos(camYaw) * CAMERA_DISTANCE;

    camera.position.set(
      player.position.x + offsetX,
      player.position.y + CAMERA_HEIGHT,
      player.position.z + offsetZ
    );

    // camera rotation: yaw then pitch (YXZ order)
    camera.rotation.y = camYaw + Math.PI; // face the player (we want the camera to look towards -forward)
    camera.rotation.x = camPitch;
  }

  // ----- Movement vector helper (fixed forward) -----
  function getForwardVector() {
    // Forward relative to camera yaw (where the player is looking)
    return new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
  }
  function getRightVector() {
    const f = getForwardVector();
    return new THREE.Vector3(f.z, 0, -f.x).normalize();
  }

  // ----- Bullet system -----
  const bullets = [];
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  function shoot() {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), bulletMat);
    b.position.copy(camera.position);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    b.velocity = dir.multiplyScalar(BULLET_SPEED);
    b._bbox = new THREE.Box3().setFromCenterAndSize(b.position, new THREE.Vector3(0.25,0.25,0.25));
    bullets.push(b);
    scene.add(b);
  }

  // ----- Build system -----
  let buildModeActive = false;
  let buildMode = "wall"; // wall,floor,ramp,cone
  let rotateAmount = 0; // multiples of 90 degrees
  const builds = []; // list of placed objects
  const buildGrid = {}; // keyed by `${x}_${z}` -> { wall:obj, floor:obj, ramp:obj, cone:obj }

  const modeText = document.getElementById("modeText");
  function setModeText() { modeText.textContent = "Mode: " + (buildModeActive ? "Build" : "Play"); }
  setModeText();

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'q') {
      buildModeActive = !buildModeActive;
      setModeText();
      // show ghost if entering build mode
      updateGhostVisibility(buildModeActive);
      return;
    }
    if (!buildModeActive) return;

    if (k === 'z') buildMode = "wall";
    if (k === 'x') buildMode = "floor";
    if (k === 'c') buildMode = "ramp";
    if (k === 'v') buildMode = "cone";
    if (k === 'r') rotateAmount += Math.PI / 2;
  });

  // Reusable materials/geoms
  const matBuild = new THREE.MeshLambertMaterial({ color: 0x55aaff });
  const matGhost = new THREE.MeshLambertMaterial({ color: 0x55aaff, opacity:0.45, transparent:true });
  const geoms = {
    wall: new THREE.BoxGeometry(GRID, GRID, 0.3),
    floor: new THREE.PlaneGeometry(GRID, GRID),
    ramp: new THREE.BoxGeometry(GRID, GRID/3, GRID),
    cone: new THREE.ConeGeometry(1.8, 3, 4)
  };

  // Ghost preview
  let ghost = null;
  function makeGhost() {
    if (ghost) scene.remove(ghost);
    let g;
    if (buildMode === "floor") {
      g = new THREE.Mesh(geoms.floor, matGhost);
      g.rotation.x = -Math.PI/2;
    } else if (buildMode === "wall") {
      g = new THREE.Mesh(geoms.wall, matGhost);
    } else if (buildMode === "ramp") {
      g = new THREE.Mesh(geoms.ramp, matGhost);
    } else if (buildMode === "cone") {
      g = new THREE.Mesh(geoms.cone, matGhost);
    }
    ghost = g;
    ghost.renderOrder = 999;
    ghost.material.depthTest = false;
    scene.add(ghost);
  }
  makeGhost();

  function updateGhostVisibility(show) {
    if (!ghost) makeGhost();
    ghost.visible = !!show;
  }

  // Raycaster for placement
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);

  function snapToGridVec(v) {
    return new THREE.Vector3(
      Math.round(v.x / GRID) * GRID,
      Math.round(v.y / GRID) * GRID,
      Math.round(v.z / GRID) * GRID
    );
  }

  function gridKey(pos) {
    const sx = Math.round(pos.x / GRID) * GRID;
    const sz = Math.round(pos.z / GRID) * GRID;
    return `${sx}_${sz}`;
  }

  function canPlaceAt(tileKey, type) {
    // tile can have one of each type — prevent duplicates of same type
    const tile = buildGrid[tileKey];
    if (!tile) return true;
    return !tile[type];
  }

  function placeBuildAt(position, yaw, type) {
    const obj = new THREE.Mesh(geoms[type], matBuild.clone());
    obj.position.copy(position);
    obj.rotation.y = yaw + rotateAmount;
    if (type === "floor") obj.rotation.x = -Math.PI/2;
    if (type === "ramp") {
      // tilt ramp and orient so its 'slope' faces camera yaw
      obj.rotation.x = -Math.PI/6; // gentler ramp
      // rotate based on yaw already set above
    }
    if (type === "cone") {
      obj.rotation.x = 0; // upright
      // rotate y for variety
    }
    obj.userData.type = type;
    // compute bounding box
    obj._bbox = new THREE.Box3().setFromObject(obj);
    builds.push(obj);
    scene.add(obj);

    // register in tile map
    const key = gridKey(position);
    if (!buildGrid[key]) buildGrid[key] = {};
    buildGrid[key][type] = obj;
  }

  // Prevent identical placement by checking distance to same tile and same type
  function tryPlaceAt(worldPos) {
    const tilePos = snapToGridVec(worldPos);
    const key = gridKey(tilePos);
    if (!canPlaceAt(key, buildMode)) {
      // can't place same kind in same tile
      return;
    }
    placeBuildAt(tilePos, camYaw, buildMode);
  }

  // Mouse click behaviour
  document.addEventListener('mousedown', (e) => {
    if (buildModeActive) {
      // Place at ghost position (if ghost is visible)
      if (!ghost || !ghost.visible) return;
      // use ghost's position
      tryPlaceAt(ghost.position);
      refreshBuildBBoxes();
    } else {
      shoot();
    }
  });

  // update ghost each frame (raycast forward to place on ground)
  function updateGhost() {
    if (!ghost) return;
    // project forward from camera to find a placement point ~5 units in front
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const origin = camera.position.clone();
    ray.set(origin, forward);
    const intersects = ray.intersectObject(ground, false);
    let targetPoint;
    if (intersects.length > 0) {
      targetPoint = intersects[0].point;
    } else {
      // fallback: a point in front at y = player.position.y
      targetPoint = origin.clone().add(forward.multiplyScalar(6));
      targetPoint.y = 0;
    }
    // place ghost slightly above ground if needed (some meshes are centered)
    const snapped = snapToGridVec(targetPoint);
    ghost.position.copy(snapped);
    // rotation
    ghost.rotation.y = camYaw + rotateAmount;
    if (buildMode === 'floor') ghost.rotation.x = -Math.PI/2;
    if (buildMode === 'ramp') ghost.rotation.x = -Math.PI/6;
  }

  // ----- Simple collision helpers -----
  function refreshBuildBBoxes(){
    for (const b of builds) {
      b._bbox = new THREE.Box3().setFromObject(b);
    }
  }

  function playerCollidesWithBuilds(nextPos) {
    // approximate player as box with width/depth ~0.8 height 1.6
    const half = 0.6;
    const pbox = new THREE.Box3(
      new THREE.Vector3(nextPos.x - half, nextPos.y - PLAYER_HEIGHT/2, nextPos.z - half),
      new THREE.Vector3(nextPos.x + half, nextPos.y + PLAYER_HEIGHT/2, nextPos.z + half)
    );
    for (const b of builds) {
      if (!b._bbox) b._bbox = new THREE.Box3().setFromObject(b);
      if (pbox.intersectsBox(b._bbox)) return true;
    }
    return false;
  }

  // ----- Game state: physics for player -----
  const playerState = { velocity: new THREE.Vector3(0,0,0), grounded: false };

  // ----- Bullet/build collision detection & cleanup -----
  function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.position.add(b.velocity);
      b._bbox.setFromCenterAndSize(b.position, new THREE.Vector3(0.25,0.25,0.25));

      // remove if far away
      if (b.position.length() > 250) {
        scene.remove(b);
        bullets.splice(i,1);
        continue;
      }

      // collide with builds
      let hitIndex = -1;
      for (let j = 0; j < builds.length; j++) {
        const target = builds[j];
        if (!target._bbox) target._bbox = new THREE.Box3().setFromObject(target);
        if (b._bbox.intersectsBox(target._bbox)) {
          hitIndex = j;
          break;
        }
      }
      if (hitIndex >= 0) {
        const hitObj = builds[hitIndex];
        // remove build
        const tile = buildGrid[gridKey(hitObj.position)];
        if (tile && tile[hitObj.userData.type]) delete tile[hitObj.userData.type];
        scene.remove(hitObj);
        builds.splice(hitIndex, 1);

        // remove bullet
        scene.remove(b);
        bullets.splice(i,1);
      }
    }
  }

  // ----- Window resize -----
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ----- Utility: find ground height at point (very simple, ground y=0) -----
  function groundHeightAt(x, z) {
    // if you later add heightfield/terrain, raycast or read heightmap here
    return 0;
  }

  // ----- Jump handling -----
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (playerState.grounded) {
        playerState.velocity.y = JUMP_VELOCITY;
        playerState.grounded = false;
      }
    }
  });

  // ----- Refresh bbox after changes -----
  function refreshAll() {
    refreshBuildBBoxes();
  }

  // ----- Main loop -----
  function animate() {
    requestAnimationFrame(animate);

    // --- movement ---
    const forward = getForwardVector();
    const right = getRightVector();
    let move = new THREE.Vector3();

    if (keys['w']) move.add(forward);
    if (keys['s']) move.add(forward.clone().multiplyScalar(-1));
    if (keys['a']) move.add(right.clone().multiplyScalar(-1));
    if (keys['d']) move.add(right);

    if (move.lengthSq() > 0) move.normalize().multiplyScalar(MOVE_SPEED);

    // apply horizontal movement while checking collisions
    const nextPos = player.position.clone();
    nextPos.x += move.x;
    nextPos.z += move.z;

    // vertical physics
    playerState.velocity.y += GRAVITY;
    nextPos.y += playerState.velocity.y;

    // simple ground collision
    const groundY = groundHeightAt(nextPos.x, nextPos.z) + PLAYER_HEIGHT;
    if (nextPos.y <= groundY) {
      nextPos.y = groundY;
      playerState.velocity.y = 0;
      playerState.grounded = true;
    } else {
      playerState.grounded = false;
    }

    // check collisions with builds for horizontal movement only (allow sliding vertically)
    const horizCheckPos = player.position.clone();
    horizCheckPos.x += move.x;
    horizCheckPos.z += move.z;
    horizCheckPos.y = player.position.y; // don't include vertical movement for horizontal collision tests

    if (!playerCollidesWithBuilds(horizCheckPos)) {
      player.position.x = horizCheckPos.x;
      player.position.z = horizCheckPos.z;
    } else {
      // attempt axis-separated movement for sliding
      const tryX = player.position.clone(); tryX.x = horizCheckPos.x;
      if (!playerCollidesWithBuilds(tryX)) player.position.x = tryX.x;
      const tryZ = player.position.clone(); tryZ.z = horizCheckPos.z;
      if (!playerCollidesWithBuilds(tryZ)) player.position.z = tryZ.z;
      // otherwise blocked
    }

    // apply vertical
    player.position.y = nextPos.y;

    // update camera for smooth following
    updateCamera();

    // update ghost if in build mode
    if (buildModeActive) {
      updateGhost();
    }

    // bullets
    updateBullets();

    renderer.render(scene, camera);
  }

  // ----- initial populate (optional) -----
  refreshAll();
  animate();

  // ----- Public debug helpers (optional) -----
  window.__game = {
    scene, builds, bullets, player, camera, placeBuildAt, tryPlaceAt, refreshAll
  };

  // keep ghost geometry in sync with selected build type
  const buildSelectionObserver = new MutationObserver(() => {});
  // simplified: update ghost when buildMode changes (keyboard changes it)
  setInterval(() => {
    // if buildMode changed, remake ghost to match geometry shape
    if (ghost && ghost.userDataMode === buildMode) return;
    // small debounce: recreate ghost when buildMode changes
    ghost && (scene.remove(ghost), ghost = null);
    makeGhost();
    if (ghost) ghost.userDataMode = buildMode;
    updateGhostVisibility(buildModeActive);
  }, 120);

})();
