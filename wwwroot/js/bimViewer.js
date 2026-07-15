window.bimViewer = (function () {

  /* ══════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════ */
  let dotNetRef = null;
  let canvas, viewport, renderer, scene, camera, controls;
  let modelGroup = new THREE.Group();
  let grid = null;
  let selectedMesh = null;
  let rawJson = null;         // last successfully loaded JSON string (for download)
  let filterState = {};       // { typeKey: { visible, meshes: THREE.Mesh[] } }

  const LS_COLOR_KEY = "bimviewer_type_colors";
  const DEFAULT_COLORS = {
    IFCWALL:0x5b8fc7, IFCWALLSTANDARDCASE:0x5b8fc7,
    IFCSLAB:0x6b7d99, IFCCOLUMN:0x3f7cb8, IFCBEAM:0xd17a3a,
    IFCDOOR:0xc98a3e, IFCWINDOW:0x4fa8d8,
    IFCSTAIR:0x8a5fc2, IFCSTAIRFLIGHT:0xa46bd6,
    IFCROOF:0x4a6fa1, IFCFURNISHINGELEMENT:0x9c7748,
    IFCFOOTING:0x7a6a55, IFCPILE:0x6b5d4d,
    IFCCURTAINWALL:0x4ea0d6, IFCRAMP:0x7a63d1, IFCRAMPFLIGHT:0x9b72e6,
    IFCPLATE:0x7d8694, IFCMEMBER:0xc97650, IFCCOVERING:0x5f95c7,
    IFCRAILING:0x8f6b4a, IFCBUILDINGELEMENTPROXY:0x7c8a99,
    IFCPIPESEGMENT:0x3cb371, IFCPIPEFITTING:0x2b8c6f,
    IFCDUCTSEGMENT:0x4dd0a8, IFCDUCTFITTING:0x28a58d,
    IFCAIRTERMINAL:0x1f9d9a, IFCSANITARYTERMINAL:0x5cc5b8,
    IFCFLOWTERMINAL:0x2f9e8f, IFCDISTRIBUTIONPORT:0x4a9d8f,
    DEFAULT:0x4d84b0,
  };
  let TYPE_COLORS = Object.assign({}, DEFAULT_COLORS);
  const SELECT_COLOR = 0xff9d00;

  function numToHex(n) { return "#" + ((n | 0) & 0xffffff).toString(16).padStart(6, "0"); }
  function hexToNum(h) { return parseInt((h || "#000000").replace("#", ""), 16); }
  function loadStoredColors() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_COLOR_KEY) || "{}");
      for (const [k, v] of Object.entries(s)) if (typeof v === "string" && v.startsWith("#")) TYPE_COLORS[k] = hexToNum(v);
    } catch (e) { }
  }
  function saveStoredColors() {
    try {
      const o = {};
      for (const [k, v] of Object.entries(TYPE_COLORS)) o[k] = numToHex(v);
      localStorage.setItem(LS_COLOR_KEY, JSON.stringify(o));
    } catch (e) { }
  }
  function resetStoredColorsInternal() {
    try { localStorage.removeItem(LS_COLOR_KEY); } catch (e) { }
    TYPE_COLORS = Object.assign({}, DEFAULT_COLORS);
  }

  function log(msg, level) {
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnLog", msg, level || "info");
  }

  /* ══════════════════════════════════════════════
     CAMERA ANIMATION
  ══════════════════════════════════════════════ */
  const camAnim = {
    active: false, t: 0, dur: 0.38,
    fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(),
    fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3(),
  };
  function animCameraTo(toPos, toTgt, dur = 0.38) {
    camAnim.fromPos.copy(camera.position);
    camAnim.fromTgt.copy(controls.target);
    camAnim.toPos.copy(toPos);
    camAnim.toTgt.copy(toTgt);
    camAnim.t = 0; camAnim.dur = dur; camAnim.active = true;
  }
  function tickCameraAnim(dt) {
    if (!camAnim.active) return;
    camAnim.t = Math.min(camAnim.t + dt / camAnim.dur, 1);
    const e = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, e);
    if (camAnim.t >= 1) camAnim.active = false;
  }

  /* ══════════════════════════════════════════════
     WASD MOVEMENT
  ══════════════════════════════════════════════ */
  const keys = {};
  let moveSpeed = 5;
  function isTyping() {
    const t = document.activeElement && document.activeElement.tagName;
    return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
  }
  const _moveDir = new THREE.Vector3();
  const _moveRight = new THREE.Vector3();
  const _moveUp = new THREE.Vector3(0, 1, 0);

  function tickMovement(dt) {
    if (isTyping()) return;
    const shift = keys["ShiftLeft"] || keys["ShiftRight"];
    const speed = (shift ? 6 : 1) * moveSpeed * dt;
    const fw = keys["KeyW"] || keys["ArrowUp"];
    const bk = keys["KeyS"];
    const lt = keys["KeyA"] || keys["ArrowLeft"];
    const rt = keys["KeyD"] || keys["ArrowRight"];
    const dn = keys["KeyQ"] || keys["PageDown"];
    const up = keys["KeyE"] || keys["PageUp"];
    if (!fw && !bk && !lt && !rt && !dn && !up) return;
    camAnim.active = false;

    if (fpvActive) {
      camera.getWorldDirection(_moveDir);
      _moveRight.crossVectors(_moveDir, _moveUp).normalize();
      if (fw) camera.position.addScaledVector(_moveDir, speed);
      if (bk) camera.position.addScaledVector(_moveDir, -speed);
      if (lt) camera.position.addScaledVector(_moveRight, -speed);
      if (rt) camera.position.addScaledVector(_moveRight, speed);
      if (dn) camera.position.y -= speed;
      if (up) camera.position.y += speed;
      const fwd2 = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.target.copy(camera.position).addScaledVector(fwd2, 2);
    } else {
      _moveDir.copy(controls.target).sub(camera.position);
      _moveDir.y = 0;
      if (_moveDir.lengthSq() < 1e-6) _moveDir.set(0, 0, -1);
      _moveDir.normalize();
      _moveRight.crossVectors(_moveDir, _moveUp).normalize();
      const delta = new THREE.Vector3();
      if (fw) delta.addScaledVector(_moveDir, speed);
      if (bk) delta.addScaledVector(_moveDir, -speed);
      if (lt) delta.addScaledVector(_moveRight, -speed);
      if (rt) delta.addScaledVector(_moveRight, speed);
      if (dn) delta.y -= speed;
      if (up) delta.y += speed;
      camera.position.add(delta);
      controls.target.add(delta);
    }
  }

  /* ══════════════════════════════════════════════
     FPV LOOK-AROUND
  ══════════════════════════════════════════════ */
  const fpvEuler = new THREE.Euler(0, 0, 0, "YXZ");
  let fpvActive = false, fpvDragging = false, fpvLastX = 0, fpvLastY = 0;

  function setFPV(on) {
    fpvActive = on;
    if (on) {
      controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.enableRotate = false;
    } else {
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.enableRotate = true;
      fpvDragging = false;
    }
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnFpvChanged", on);
  }

  /* ══════════════════════════════════════════════
     PIVOT INDICATOR (double-click focus)
  ══════════════════════════════════════════════ */
  let pivotHint, pivotCircle, pivotFadeTimer = null;
  function showPivotAt(x, y) {
    if (!pivotHint) return;
    pivotHint.style.left = x + "px"; pivotHint.style.top = y + "px";
    pivotCircle.style.left = x + "px"; pivotCircle.style.top = y + "px";
    pivotHint.classList.add("visible"); pivotCircle.classList.add("visible");
    clearTimeout(pivotFadeTimer);
    pivotFadeTimer = setTimeout(() => {
      pivotHint.classList.remove("visible"); pivotCircle.classList.remove("visible");
    }, 900);
  }

  /* ══════════════════════════════════════════════
     PRESET VIEWS
  ══════════════════════════════════════════════ */
  function presetView(type) {
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / (2 * Math.tan(camera.fov * Math.PI / 180 / 2))) * 1.6;
    let toPos;
    if (type === "top") toPos = new THREE.Vector3(center.x, center.y + dist, center.z);
    if (type === "front") toPos = new THREE.Vector3(center.x, center.y + dist * 0.15, center.z + dist);
    if (type === "side") toPos = new THREE.Vector3(center.x + dist, center.y + dist * 0.15, center.z);
    animCameraTo(toPos, center, 0.45);
  }

  function fitCamera() {
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / (2 * Math.tan(camera.fov * Math.PI / 180 / 2))) * 1.7;
    const toPos = new THREE.Vector3(center.x + dist * 0.8, center.y + dist * 0.6, center.z + dist * 0.8);
    animCameraTo(toPos, center, 0.45);
    if (grid) grid.position.y = box.min.y;
  }

  /* ══════════════════════════════════════════════
     GEOMETRY / SCENE BUILD
  ══════════════════════════════════════════════ */
  function getTypeKey(e) {
    const r = (e.properties && (e.properties.ifc_type || e.properties.dxf_type)) || e.type || "UNKNOWN";
    return (r || "UNKNOWN").toUpperCase();
  }
  function colorForKey(k) { return TYPE_COLORS[k] !== undefined ? TYPE_COLORS[k] : TYPE_COLORS.DEFAULT; }
  function buildGeometry(entity) {
    const v = entity.vertices, f = entity.faces;
    if (!Array.isArray(v) || !v.length || !Array.isArray(f) || !f.length) return null;
    const pos = new Float32Array(v.length * 3);
    for (let i = 0; i < v.length; i++) { pos[i * 3] = v[i].x; pos[i * 3 + 1] = v[i].y; pos[i * 3 + 2] = v[i].z; }
    const idx = new Uint32Array(f.length * 3);
    for (let i = 0; i < f.length; i++) { idx[i * 3] = f[i][0]; idx[i * 3 + 1] = f[i][1]; idx[i * 3 + 2] = f[i][2]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  function clearModel() {
    while (modelGroup.children.length) {
      const o = modelGroup.children[modelGroup.children.length - 1];
      modelGroup.remove(o);
      o.geometry && o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    }
    filterState = {};
    selectedMesh = null;
    rawJson = null;
  }

  function labelFor(key) {
    return key.length ? key[0] + key.slice(1).toLowerCase() : key;
  }

  function buildFilterPanelPayload() {
    const typeMap = {};
    for (const m of modelGroup.children) {
      const k = m.userData.typeKey;
      if (!typeMap[k]) typeMap[k] = [];
      typeMap[k].push(m);
    }
    filterState = {};
    const types = Object.keys(typeMap).sort();
    const payload = types.map(key => {
      filterState[key] = { visible: true, meshes: typeMap[key] };
      return {
        Key: key,
        Label: labelFor(key),
        Count: typeMap[key].length,
        ColorHex: numToHex(colorForKey(key)),
        Visible: true
      };
    });
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnTypesBuilt", payload);
  }

  function buildScene(json) {
    clearModel();
    clearSelectionInternal();
    const entities = Array.isArray(json.entities) ? json.entities
      : Array.isArray(json.data) ? json.data
      : Array.isArray(json) ? json : [];
    log("Entities received: " + entities.length, "info");
    let meshCount = 0, vertCount = 0, triCount = 0, skipped = 0;
    for (const entity of entities) {
      const typeKey = getTypeKey(entity), geo = buildGeometry(entity);
      if (!geo) { log("  No geometry: " + typeKey + " '" + (entity.name || entity.id || "?") + "'", "warn"); skipped++; continue; }
      const baseColor = colorForKey(typeKey);
      const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.entity = entity; mesh.userData.typeKey = typeKey; mesh.userData.baseColor = baseColor;
      modelGroup.add(mesh);
      const v = geo.attributes.position.count, t = geo.index ? geo.index.count / 3 : Math.round(v / 3);
      vertCount += v; triCount += Math.round(t); meshCount++;
      log("  ✓ " + typeKey + " '" + (entity.name || entity.id || "") + "' verts:" + v + " tris:" + Math.round(t), "ok");
    }
    if (skipped > 0) log(skipped + " entity/entities had no geometry.", "warn");
    log("Meshes rendered: " + meshCount, "ok");
    log("Total verts: " + vertCount.toLocaleString() + "  tris: " + triCount.toLocaleString(), "ok");

    if (dotNetRef) {
      dotNetRef.invokeMethodAsync("OnStats", { Entities: entities.length, Meshes: meshCount, Vertices: vertCount, Triangles: triCount });
    }

    const box2 = new THREE.Box3().setFromObject(modelGroup);
    const diag = box2.getSize(new THREE.Vector3()).length();
    moveSpeed = Math.max(1, diag * 0.08);

    fitCamera();
    buildFilterPanelPayload();
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnModelLoaded");
  }

  /* ══════════════════════════════════════════════
     SELECTION / DETAIL POPUP
  ══════════════════════════════════════════════ */
  function buildDetailPayload(entity) {
    const p = entity.properties || {};
    const rows = [];
    const add = (k, v) => rows.push({ Key: k, Value: v === undefined || v === null ? "" : String(v) });
    if (p.expressID !== undefined) add("Express ID", p.expressID);
    if (p.globalId) add("Global ID", p.globalId);
    if (p.ifc_type) add("IFC Type", p.ifc_type);
    if (p.dxf_type) add("DXF Type", p.dxf_type);
    if (p.layer) add("Layer", p.layer);
    if (p.color) add("Color", p.color);
    add("Entity ID", entity.id ?? "—");
    if (Array.isArray(entity.vertices) && Array.isArray(entity.faces)) {
      add("Vertices", entity.vertices.length.toLocaleString());
      add("Triangles", entity.faces.length.toLocaleString());
    }
    const known = new Set(["expressID", "globalId", "ifc_type", "dxf_type", "layer", "color"]);
    for (const k of Object.keys(p)) {
      if (known.has(k)) continue;
      let v = p[k];
      if (v !== null && typeof v === "object") { try { v = JSON.stringify(v); } catch (e) { v = String(v); } }
      add(k, v);
    }
    return {
      Title: entity.name || p.globalId || entity.id || "Unnamed",
      TypeLabel: p.ifc_type || p.dxf_type || entity.type || "UNKNOWN",
      Rows: rows
    };
  }

  function clearSelectionInternal() {
    if (selectedMesh) {
      selectedMesh.material.color.setHex(selectedMesh.userData.baseColor);
      selectedMesh.material.emissive && selectedMesh.material.emissive.setHex(0x000000);
    }
    selectedMesh = null;
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnElementDeselected");
  }

  function selectMesh(mesh) {
    if (selectedMesh === mesh) return;
    if (selectedMesh) {
      selectedMesh.material.color.setHex(selectedMesh.userData.baseColor);
      selectedMesh.material.emissive && selectedMesh.material.emissive.setHex(0x000000);
    }
    selectedMesh = mesh;
    mesh.material.color.setHex(SELECT_COLOR);
    if (mesh.material.emissive) mesh.material.emissive.setHex(0x402a00);
    if (dotNetRef) dotNetRef.invokeMethodAsync("OnElementSelected", buildDetailPayload(mesh.userData.entity));
  }

  /* ══════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════ */
  function init(canvasId, viewportId, pivotHintId, pivotCircleId, dotNetReference) {
    dotNetRef = dotNetReference;
    canvas = document.getElementById(canvasId);
    viewport = document.getElementById(viewportId);
    pivotHint = document.getElementById(pivotHintId);
    pivotCircle = document.getElementById(pivotCircleId);

    loadStoredColors();

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf7ff);
    camera = new THREE.PerspectiveCamera(55, 1, 0.01, 50000);
    camera.position.set(15, 12, 15);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.01;
    controls.maxDistance = 50000;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(20, 40, 20); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7ccfff, 0.28); fill.position.set(-10, 5, -15); scene.add(fill);

    grid = new THREE.GridHelper(500, 200, 0x78a6c8, 0xc5dce9); scene.add(grid);
    modelGroup = new THREE.Group(); scene.add(modelGroup);

    function resize() {
      const w = viewport.clientWidth, h = viewport.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);
    new ResizeObserver(resize).observe(viewport);

    // Keyboard
    window.addEventListener("keydown", e => { keys[e.code] = true; });
    window.addEventListener("keyup", e => { keys[e.code] = false; });
    window.addEventListener("keydown", e => {
      if (isTyping()) return;
      switch (e.code) {
        case "KeyL": setFPV(!fpvActive); break;
        case "KeyT": presetView("top"); break;
        case "KeyF": presetView("front"); break;
        case "KeyR": presetView("side"); break;
        case "Home": fitCamera(); break;
        case "Escape":
          clearSelectionInternal();
          if (fpvActive) setFPV(false);
          break;
      }
    });

    // FPV drag
    canvas.addEventListener("pointerdown", e => {
      if (!fpvActive || e.button !== 0) return;
      fpvDragging = true; fpvLastX = e.clientX; fpvLastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", e => {
      if (!fpvActive || !fpvDragging) return;
      const dx = e.clientX - fpvLastX, dy = e.clientY - fpvLastY;
      fpvLastX = e.clientX; fpvLastY = e.clientY;
      fpvEuler.setFromQuaternion(camera.quaternion, "YXZ");
      fpvEuler.y -= dx * 0.0025;
      fpvEuler.x -= dy * 0.0025;
      fpvEuler.x = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, fpvEuler.x));
      camera.quaternion.setFromEuler(fpvEuler);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.target.copy(camera.position).addScaledVector(fwd, 2);
      controls.update();
      camAnim.active = false;
    });
    canvas.addEventListener("pointerup", e => {
      if (fpvDragging && e.button === 0) { fpvDragging = false; canvas.releasePointerCapture(e.pointerId); }
    });

    // Double-click focus
    const _rcDbl = new THREE.Raycaster(), _ndcDbl = new THREE.Vector2();
    canvas.addEventListener("dblclick", e => {
      const rect = canvas.getBoundingClientRect();
      _ndcDbl.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _ndcDbl.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _rcDbl.setFromCamera(_ndcDbl, camera);
      const hits = _rcDbl.intersectObjects(modelGroup.children, false);
      if (!hits.length) return;
      const hit = hits[0];
      const newTarget = hit.point.clone();
      const distToHit = camera.position.distanceTo(newTarget);
      const newCamPos = camera.position.clone();
      if (distToHit > 1) newCamPos.lerp(newTarget, 0.35);
      animCameraTo(newCamPos, newTarget, 0.32);
      showPivotAt(e.clientX - rect.left, e.clientY - rect.top);
      camAnim.active = true;
      selectMesh(hit.object);
    });

    // Single-click picking
    const raycaster = new THREE.Raycaster(), pointerNDC = new THREE.Vector2();
    let pointerDownPos = null;
    const DRAG_TOL = 6;
    canvas.addEventListener("pointerdown", e => { if (fpvActive && e.button === 0) return; pointerDownPos = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener("pointerup", e => {
      if (fpvActive && e.button === 0) return;
      if (!pointerDownPos) return;
      const dx = e.clientX - pointerDownPos.x, dy = e.clientY - pointerDownPos.y; pointerDownPos = null;
      if (Math.hypot(dx, dy) > DRAG_TOL) return;
      const rect = canvas.getBoundingClientRect();
      pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      const hits = raycaster.intersectObjects(modelGroup.children, false);
      if (hits.length > 0) selectMesh(hits[0].object); else clearSelectionInternal();
    });

    // Render loop
    let lastTime = performance.now();
    (function animate() {
      requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      tickCameraAnim(dt);
      tickMovement(dt);
      controls.update();
      renderer.render(scene, camera);
    })();
  }

  function loadModel(jsonString) {
    let json;
    try { json = JSON.parse(jsonString); }
    catch (e) { log("Invalid JSON: " + e.message, "err"); return; }
    rawJson = jsonString;
    buildScene(json);
  }

  function resetAll() {
    clearModel();
    if (grid) grid.position.y = 0;
    setFPV(false);
  }

  function toggleTypeVisibility(key) {
    const s = filterState[key]; if (!s) return;
    s.visible = !s.visible;
    for (const m of s.meshes) m.visible = s.visible;
    return s.visible;
  }

  function setAllVisible(visible) {
    for (const k of Object.keys(filterState)) {
      filterState[k].visible = visible;
      for (const m of filterState[k].meshes) m.visible = visible;
    }
  }

  function setTypeColor(key, hex) {
    TYPE_COLORS[key] = hexToNum(hex);
    saveStoredColors();
    const s = filterState[key]; if (!s) return;
    for (const m of s.meshes) {
      m.userData.baseColor = hexToNum(hex);
      if (selectedMesh !== m) m.material.color.setHex(hexToNum(hex));
    }
  }

  function resetColors() {
    resetStoredColorsInternal();
    const updated = {};
    for (const key of Object.keys(filterState)) {
      const c = colorForKey(key);
      for (const m of filterState[key].meshes) {
        m.userData.baseColor = c;
        if (selectedMesh !== m) m.material.color.setHex(c);
      }
      updated[key] = numToHex(c);
    }
    log("Colors reset to defaults.", "info");
    return updated;
  }

  function downloadJson(filename) {
    if (!rawJson) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rawJson], { type: "application/json" }));
    a.download = filename || "cadjson-export.json";
    a.click();
  }

  return {
    init, loadModel, resetAll, fitCamera, presetView, setFPV,
    toggleTypeVisibility, setAllVisible, setTypeColor, resetColors,
    downloadJson
  };
})();