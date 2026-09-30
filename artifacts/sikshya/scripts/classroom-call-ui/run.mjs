/**
 * Coordinate-based regression checks for the actual teacher/student classroom shells.
 * API, board engine, socket and media transport are deterministic stand-ins. The two route
 * components, LiveKit call surface, shared dock, chat and moderation drawer are the real UI.
 * CALL_LAYOUT_REAL_BOARD=1 also mounts the real Excalidraw board engine.
 * This proves layout and hit testing in Chromium, not physical iOS/Android or live media.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(path.join(tmpdir(), "fadko-call-layout-"));
const shots = process.env.CALL_LAYOUT_SHOTS || path.join(tmpdir(), "fadko-call-layout-shots");
mkdirSync(shots, { recursive: true });
const stub = (name, source, extension = "jsx") => {
  const file = path.join(work, `${name}.${extension}`);
  writeFileSync(file, source);
  return file;
};
const alias = {
  "@/context/AuthContext": stub("auth", `export function useAuth(){return {user:{id:window.__role==='student'?2:1,name:window.__role==='student'?'Student':'Teacher',role:window.__role}}}`),
  "expo-router": stub("router", `export const router={back(){},replace(){},push(){}};export function useLocalSearchParams(){return {id:'1'}};`),
  "@/utils/api": stub("api", `
    export class ApiError extends Error{}
    export async function apiGet(route){
      if(route.endsWith('/room')){window.__roomCalls=(window.__roomCalls||0)+1;return {provider:'livekit',roomUrl:'wss://example.invalid',token:'test',teacherUserId:'1',capabilities:{moderatesPublishing:true}}}
      if(route.endsWith('/materials'))return {materials:[]};
      return {id:1,topic:'Mathematics · Lesson 8',teacherName:'Teacher',duration:60,date:new Date(Date.now()-60000).toISOString(),startedAt:new Date(Date.now()-60000).toISOString(),status:'live',enrolledCount:1,maxStudents:50,serverTime:new Date().toISOString(),classGroup:{batchId:1,title:'Math',lessonCount:30,lessonPosition:7}};
    }
    export async function apiPatch(){return {}} export async function apiPost(){return {}}
  `),
  "@/hooks/useClassroomSocket": stub("socket", `
    import React from 'react';
    const noop=()=>{};
    const actions=Object.fromEntries(['ask','cancelAsk','accept','mediaReady','setMic','setCamera','decline','listenOnly','joinDiscussion','leaveDiscussion','allow','dismiss','cancelInvite','cancelInvites','inviteAll','mute','muteAll','stopCamera','returnToAudience','startDiscussion','endDiscussion','spotlight'].map(k=>[k,noop]));
    const you={state:'audience',requestedAt:null,invitedAt:null,invitationScope:null,allowedMic:false,allowedCamera:false,acceptedMic:false,acceptedCamera:false,provider:'ok'};
    const student={userId:2,name:'Student',state:'audience',requestedAt:null,invitedAt:null,invitationScope:null,connected:true,allowedMic:false,allowedCamera:false,provider:'ok'};
    export function useClassroomSocket(){
      const [messages,setMessages]=React.useState([]);
      const [yourState,setYourState]=React.useState(you);
      window.__setFloor=(update)=>setYourState(prev=>({...prev,...update}));
      const base={mode:'classroom',discussionEligible:false,discussionStartedAt:null,spotlight:null};
      const floor=window.__role==='student'?{...base,scope:'student',handsUp:0,queuePosition:null,you:yourState}:{...base,scope:'teacher',students:[student],queue:[],participantCount:1};
      return {connected:true,accessDenied:false,presenceCount:2,messages,floatingReactions:[],sendReaction:noop,sessionStatus:'live',boardClearedAt:0,sceneUpdates:[],consumeSceneUpdates:noop,sendSceneUpdate:noop,sendBoardView:noop,sendChat:(text)=>{window.__sent.push(text);setMessages(prev=>[...prev,{id:String(prev.length),senderName:window.__role,text,time:'now',isMe:true}])},sendBoardClear:noop,clearMaterial:noop,materialRejected:null,clearMaterialRejected:noop,boardPages:[{id:'1',title:'Page 1',template:'blank'}],activeBoardPageId:'1',boardPageChangedAt:0,sendBoardPage:noop,boardLaser:null,sendBoardLaser:noop,floor,floorRefusal:null,clearFloorRefusal:noop,floorActions:actions};
    }
  `),
  "@/components/SmartBoard": stub("board", `import React from 'react'; export default function Board({onOverlayChange}){return <div data-testid="fixture-board" style={{position:'absolute',inset:0,background:'#fff'}}><button data-testid="fixture-board-tools" style={{position:'absolute',top:8,left:'35%',height:44}}>Drawing tools</button><button data-testid="fixture-board-overlay" style={{position:'absolute',bottom:8,left:8,height:44}} onClick={()=>onOverlayChange?.(true)}>Board menu</button></div>}`),
  "@/components/DailyEmbed": stub("daily", `export default function Daily(){return null}`),
  "@/utils/notifications": stub("notifications", `export async function cancelSessionReminder(){}`),
  "expo-haptics": stub("haptics", `export async function impactAsync(){} export async function notificationAsync(){} export const NotificationFeedbackType={};export const ImpactFeedbackStyle={};`),
  "expo-document-picker": stub("documents", `export async function getDocumentAsync(){return {canceled:true}}`),
  "expo-image-picker": stub("images", `export async function launchImageLibraryAsync(){return {canceled:true}} export async function requestMediaLibraryPermissionsAsync(){return {granted:true}} export const MediaTypeOptions={Images:'Images'};`),
  "expo-file-system": stub("filesystem", `export class File{}`),
  "react-native-safe-area-context": stub("safearea", `import React from 'react';export const SafeAreaInsetsContext=React.createContext({top:0,bottom:0,left:0,right:0});export function useSafeAreaInsets(){return window.__safeArea||{top:0,bottom:0,left:0,right:0}}`),
  "expo-font": stub("fonts", `const loaded=new Set();export async function loadAsync(name,source){for(const [family,src] of typeof name==='string'?[[name,source]]:Object.entries(name||{})){if(loaded.has(family))continue;const url=typeof src==='string'?src:src?.uri||src?.default;if(!url)continue;const s=document.createElement('style');s.textContent='@font-face{font-family:"'+family+'";src:url("'+url+'")}';document.head.appendChild(s);loaded.add(family)}}export function isLoaded(n){return loaded.has(n)}export function isLoading(){return false}export function useFonts(m){void loadAsync(m);return [true,null]}export function processFontFamily(n){return n}export function getLoadedFonts(){return [...loaded]}export default {loadAsync,isLoaded,isLoading,useFonts,processFontFamily,getLoadedFonts}`),
};
alias["@/lib/video"] = stub("video", `
  const rosterListeners=new Set(); const connectionListeners=new Set();
  const local={id:window.__role==='student'?'2':'1',name:window.__role==='student'?'Student':'Teacher',isLocal:true,isSpeaking:false,micEnabled:false,cameraEnabled:false,camera:null,screen:null,microphone:null,quality:'excellent'};
  const remote={id:window.__role==='student'?'1':'2',name:window.__role==='student'?'Teacher':'Student',isLocal:false,isSpeaking:false,micEnabled:true,cameraEnabled:false,camera:null,screen:null,microphone:null,quality:'excellent'};
  const roster=()=>{for(const fn of rosterListeners)fn([local,remote].map(p=>({...p})))};
  const session={provider:'livekit',audioOnly:false,audioBlocked:false,async leaveRoom(){},async toggleMic(){local.micEnabled=!local.micEnabled;roster();return local.micEnabled},async toggleCamera(){local.cameraEnabled=!local.cameraEnabled;roster();return local.cameraEnabled},async switchCamera(){return true},async startScreenShare(){return true},async stopScreenShare(){},getParticipants(){return [local,remote].map(p=>({...p}))},async setAudioOnly(){},async unblockAudio(){},setCameraPlan(){},onConnectionStateChange(fn){connectionListeners.add(fn);fn('connected');return ()=>connectionListeners.delete(fn)},onParticipantsChange(fn){rosterListeners.add(fn);fn(session.getParticipants());return ()=>rosterListeners.delete(fn)},onMediaProblem(){return ()=>{}}};
  export async function joinRoom(){window.__joins=(window.__joins||0)+1;return session} export async function leaveRoom(){}
`);
if (process.env.CALL_LAYOUT_REAL_BOARD === "1") {
  alias["@/components/SmartBoard"] = path.join(appRoot,"components","SmartBoard.web.tsx");
  // The browser bundle helper lacks the package's production CSS export condition.
  alias["@excalidraw/excalidraw/index.css"] = path.join(appRoot,"node_modules","@excalidraw","excalidraw","dist","prod","index.css");
}

// Optional read-only baseline mode reproduces old route hit testing without touching the
// checkout. Pass the precise pre-fix commit; a failing baseline is expected evidence.
const baseline = process.env.CALL_LAYOUT_BASELINE;
const routePath = (role) => {
  if (!baseline) return path.join(appRoot,"app",`(${role})`,"classroom","[id].tsx");
  const source = execFileSync(process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "git", ["show", `${baseline}:artifacts/sikshya/app/(${role})/classroom/[id].tsx`], {cwd:appRoot,encoding:"utf8"});
  // Extracted sources are outside tsconfig's path-resolution scope. Preserve fixture aliases
  // and explicitly point every other app import back to its current shared dependency.
  for (const match of source.matchAll(/from\s+["'](@\/[^"']+)["']/g)) {
    if (!alias[match[1]]) alias[match[1]] = path.join(appRoot,match[1].slice(2));
  }
  return stub(`${role}-baseline`,source,"tsx");
};
const entry = stub("entry", `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import Teacher from ${JSON.stringify(routePath("teacher"))};
  import Student from ${JSON.stringify(routePath("student"))};
  window.__sent=[];
  createRoot(document.getElementById('root')).render(React.createElement(window.__role==='student'?Student:Teacher));
`);
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry, outfile: bundle, alias });
if (!built.ok) throw new Error(built.error);
const pagePath = path.join(work, "index.html");
writeFileSync(pagePath, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${existsSync(path.join(work,"bundle.css"))?'<link rel="stylesheet" href="bundle.css">':""}<style>html,body,#root{margin:0;height:100%;width:100%;overflow:hidden}#root{display:flex}</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);

let passed = 0;
let failed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; failures.push(`${name} — ${detail}`); console.log(`  FAIL ${name} — ${detail}`); }
};
const browser = await (await getChromium()).launch({ args: ["--no-sandbox"] });
const widths = process.env.CALL_LAYOUT_WIDTHS?.split(",").map(Number);
const roles = process.env.CALL_LAYOUT_ROLES?.split(",") || ["teacher","student"];
const sizes = [
  { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1440, height: 900 },
  { width: 844, height: 390 }, { width: 740, height: 360 },
].filter(size=>!widths || widths.includes(size.width));
try {
  for (const role of roles) for (const size of sizes) {
    const label = `${role}/${size.width}x${size.height}`;
    const context = await browser.newContext({ viewport: size, hasTouch: size.width < 600 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && /Minified React|TypeError|ReferenceError/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript((role) => {
      window.__role = role;
      window.__safeArea=innerWidth<600?{top:44,bottom:34,left:0,right:0}:innerHeight<500?{top:0,bottom:0,left:44,right:44}:{top:0,bottom:0,left:0,right:0};
      const vv = new EventTarget();
      Object.assign(vv, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
      window.__visibleViewport = (height, offsetTop=0) => { Object.assign(vv,{height,offsetTop}); vv.dispatchEvent(new Event("resize")); };
      Object.defineProperty(navigator, "permissions", { configurable: true, value:{query:async()=>({state:'granted'})} });
    }, role);
    await page.goto(`file://${pagePath}`);
    await page.getByTestId("video-window").waitFor();
    await page.waitForTimeout(500);
    if (process.env.CALL_LAYOUT_REAL_BOARD === "1") {
      await page.locator(".excalidraw canvas").first().waitFor({timeout:5000}).catch(()=>{});
      check(`${label}: actual Excalidraw canvas mounts beneath classroom chrome`, await page.locator(".excalidraw canvas").count()>0);
    }
    const press = async (id) => {
      // Retired HUD copies are intentionally hidden during the current shell rollout.
      // Only a rendered control qualifies, and no force/evaluate click bypasses hit testing.
      const button = page.locator(`[data-testid="${id}"]:visible`).first();
      try {
        if (size.width < 600) await button.tap({ timeout: 2000 });
        else await button.click({ timeout: 2000 });
        await page.waitForTimeout(250);
        return true;
      }
      catch (error) {
        const detail = await button.evaluate(el => {const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return `${JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})} hit:${hit?.tagName} ${hit?.getAttribute('data-testid')} ${hit?.textContent?.slice(0,60)}`}).catch(()=>"control absent");
        check(`${label}: ${id} can be physically clicked`, false, `${detail} ${String(error).split('\n')[0]}`);
        return false;
      }
    };
    if (await page.getByTestId("video-restore-btn").count()) await press("video-restore-btn");
    check(`${label}: maximize works`, await press("video-fullscreen-btn"));
    await page.screenshot({ path:path.join(shots, `${role}-${size.width}-expanded.png`) });
    if (role === "teacher" && process.env.CALL_LAYOUT_REAL_BOARD === "1") {
      const footer = await page.locator(".sikshya-board__pages").boundingBox();
      const dockButton = await page.locator('[data-testid="classroom-dock-more"]:visible').boundingBox();
      const overlap = footer && dockButton && footer.x<dockButton.x+dockButton.width && footer.x+footer.width>dockButton.x && footer.y<dockButton.y+dockButton.height && footer.y+footer.height>dockButton.y;
      check(`${label}: classroom dock leaves real board page and zoom footer clear`, footer && dockButton && !overlap, JSON.stringify({footer,dockButton}));
      const pages = page.getByRole("button",{name:"Open board pages",exact:true});
      if (size.width < 600) await pages.tap(); else await pages.click();
      check(`${label}: actual board page menu remains reachable during expanded teaching`, await page.getByRole("button",{name:"Close board page menu",exact:true}).isVisible());
      check(`${label}: board page menu temporarily gains media-free workspace`, !(await page.getByTestId("video-window").isVisible()));
      const close = page.getByRole("button",{name:"Close board page menu",exact:true});
      if (size.width < 600) await close.tap(); else await close.click();
      await page.waitForTimeout(250);
      check(`${label}: closing real board menu restores same expanded call`, await page.getByTestId("video-window").isVisible());
    }
    const frame = await page.getByTestId("video-window").boundingBox();
    check(`${label}: expanded call stays within viewport`, !!frame && frame.x>=0 && frame.y>=0 && frame.x+frame.width<=size.width+1 && frame.y+frame.height<=size.height+1, JSON.stringify(frame));
    check(`${label}: LiveKit More remains clickable`, await press("livekit-more"));
    check(`${label}: LiveKit settings menu remains visible`, await page.getByTestId("livekit-more-menu").isVisible());
    await press("livekit-more");
    if (role === "teacher") {
      const micLabel = await page.getByTestId("livekit-mic").getAttribute("aria-label");
      check(`${label}: call microphone toggle remains responsive`, await press("livekit-mic") && await page.getByTestId("livekit-mic").getAttribute("aria-label") !== micLabel);
      const cameraLabel = await page.getByTestId("livekit-camera").getAttribute("aria-label");
      check(`${label}: call camera toggle remains responsive`, await press("livekit-camera") && await page.getByTestId("livekit-camera").getAttribute("aria-label") !== cameraLabel);
      if (!baseline) {
      check(`${label}: class participants open above expanded media`, await press("teacher-floor-participants"));
      const participantDrawer = page.getByTestId("participant-drawer");
      if (await participantDrawer.count()) {
        const videoBox = await page.getByTestId("video-window").boundingBox();
        const panelBox = await participantDrawer.boundingBox();
        check(`${label}: class-list rail and expanded call do not overlap`, videoBox && panelBox && videoBox.x+videoBox.width<=panelBox.x, JSON.stringify({videoBox,panelBox}));
        check(`${label}: Minimize stays reachable with class list open`, await press("video-window-size-btn"));
        check(`${label}: Restore stays reachable with class list open`, await press("video-restore-btn"));
        check(`${label}: expand stays reachable with class list open`, await press("video-fullscreen-btn"));
      } else check(`${label}: phone class-list sheet is visible`, await page.getByTestId("participant-sheet").isVisible());
      check(`${label}: class participants can be dismissed`, await press("participant-sheet-close"));
      }
    } else if (!baseline) {
      await page.evaluate(()=>window.__setFloor({state:'muted-by-teacher'}));
      await page.waitForTimeout(200);
      const frameBox = await page.getByTestId("video-window").boundingBox();
      const floorBox = await page.getByTestId("student-control-layer").boundingBox();
      check(`${label}: extra permission status does not cover provider controls`, frameBox && floorBox && frameBox.y+frameBox.height<=floorBox.y, JSON.stringify({frameBox,floorBox}));
      await page.evaluate(()=>window.__setFloor({state:'audience'}));
      await page.waitForTimeout(150);
    }
    check(`${label}: Messages remains clickable`, await press("classroom-dock-chat"));
    await page.getByTestId("classroom-chat-drawer").waitFor({timeout:2000}).catch(()=>{});
    const input = page.getByTestId("chat-input");
    if (await input.count()) {
      await input.fill(`Hello from ${label}`);
      check(`${label}: send from expanded call reaches conversation`, await press("chat-send") && await page.evaluate((text)=>window.__sent.includes(text),`Hello from ${label}`));
      await page.screenshot({ path:path.join(shots, `${role}-${size.width}-chat.png`) });
      if (size.width >= 600) {
        check(`${label}: Minimize stays reachable while docked messages are open`, await press("video-window-size-btn"));
        check(`${label}: Restore remains reachable alongside messages`, await press("video-restore-btn"));
        check(`${label}: expand remains reachable alongside messages`, await press("video-fullscreen-btn"));
      }
      await press("classroom-chat-close");
      await page.waitForTimeout(250);
    } else check(`${label}: chat composer opened`, false, errors.join('\n'));
    check(`${label}: expanded More menu opens`, await press("classroom-dock-more"));
    check(`${label}: Hide call works from expanded More menu`, await press("video-visibility-btn"));
    check(`${label}: Show call returns same expanded surface`, await press("video-show-call-btn"));
    if (role === "teacher" && !baseline) {
      check(`${label}: teacher More reopens reliably`, await press("classroom-dock-more"));
      check(`${label}: teaching-material action works in video-first mode`, await press("classroom-dock-material"));
      check(`${label}: material chooser is visible, not buried under media`, await page.getByTestId("teaching-material-menu").isVisible());
      check(`${label}: material chooser can be dismissed`, await press("teaching-material-cancel"));
      await page.waitForTimeout(150);
    }
    check(`${label}: minimizing remains responsive`, await press("video-window-size-btn"));
    if (size.width === 390 || size.width === 430) {
      const landscape = {width:size.height,height:size.width};
      await page.evaluate(()=>{window.__safeArea={top:0,bottom:0,left:44,right:44};});
      await page.setViewportSize(landscape);
      await page.evaluate((height)=>window.__visibleViewport(height),landscape.height);
      await page.waitForTimeout(250);
      check(`${label}: Restore survives portrait-to-landscape rotation`, await press("video-restore-btn"));
      check(`${label}: expanded call survives live rotation`, await press("video-fullscreen-btn"));
      const rotated = await page.getByTestId("video-window").boundingBox();
      check(`${label}: rotated provider controls fit inside landscape safe area`, rotated && rotated.x>=44 && rotated.y>=0 && rotated.x+rotated.width<=landscape.width-44+1 && rotated.y+rotated.height<=landscape.height, JSON.stringify(rotated));
      check(`${label}: More works after live rotation`, await press("livekit-more"));
      await press("livekit-more");
      await page.screenshot({path:path.join(shots,`${role}-${size.width}-rotated.png`)});
      await page.evaluate(()=>{window.__safeArea={top:44,bottom:34,left:0,right:0};});
      await page.setViewportSize(size);
      await page.evaluate((height)=>window.__visibleViewport(height),size.height);
      await page.waitForTimeout(250);
      check(`${label}: Minimize survives landscape-to-portrait rotation`, await press("video-window-size-btn"));
    }
    check(`${label}: no remount on chat/hide/minimize`, await page.evaluate(()=>window.__joins===1), String(await page.evaluate(()=>window.__joins)));
    check(`${label}: no horizontal overflow`, await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    check(`${label}: no runtime errors`, errors.length===0, errors.join('\n'));
    await context.close();
  }
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${shots}`);
  if (failures.length) console.log(failures.join('\n'));
} finally {
  await browser.close();
  rmSync(work,{recursive:true,force:true});
}
process.exitCode=failed?1:0;
