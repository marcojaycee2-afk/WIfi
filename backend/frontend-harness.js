// Loads the browser scripts from assets/js into a VM with a minimal fake DOM so page logic can be unit-tested.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const billing = require('../billing');

function fakeElement(){
  const classes = new Set();
  return {
    innerHTML:'', textContent:'', value:'', hidden:false, dataset:{}, style:{},
    classList:{
      add:name=>classes.add(name), remove:name=>classes.delete(name),
      contains:name=>classes.has(name), toggle:name=>(classes.has(name) ? (classes.delete(name),false) : (classes.add(name),true))
    },
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, removeAttribute(){},
    hasAttribute:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    focus(){}, scrollIntoView(){}, after(){}, remove(){}, appendChild(){}, click(){}
  };
}

function fakeLocalStorage(){
  const values = new Map();
  return {
    values,
    getItem:key=>values.has(key) ? values.get(key) : null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
}

function frontend(state, {today='2026-12-20', fetch, localStorage=fakeLocalStorage(), synchronize=true}={}){
  const scripts = ['core','pages','naps','receipt','forms'].map(name=>
    fs.readFileSync(path.join(__dirname,'..','assets','js',`${name}.js`),'utf8'));
  const script = scripts.join('\n')
    .replace('const todayISO = () => iso(new Date());',`const todayISO = () => '${today}';`);
  const elements = new Map();
  const document = {
    getElementById(id){
      if(!elements.has(id)) elements.set(id,fakeElement());
      return elements.get(id);
    },
    querySelector:()=>null, querySelectorAll:()=>[], createElement:fakeElement,
    addEventListener(){}, contains:()=>false, activeElement:null,
    head:fakeElement(), body:fakeElement()
  };
  const quietConsole = {...console, warn(){}};
  const context = vm.createContext({
    NapboxBilling:billing, console:quietConsole, setTimeout, clearTimeout, Promise, JSON, Map, Set,
    window:{addEventListener(){},matchMedia:()=>({matches:false}),scrollTo(){},location:{hash:'',replace(){}}},
    requestAnimationFrame:callback=>callback(),
    localStorage, document,
    fetch:fetch || (async()=>{ throw new Error('offline'); })
  });
  vm.runInContext(script,context);
  context.fixture = state;
  vm.runInContext("DB = fixture; state.month = '2026-12';",context);
  if(synchronize){
    // render() synchronizes recurring invoices before any page is built
    vm.runInContext('NapboxBilling.synchronizeInvoices(DB, todayISO());',context);
  }
  context.elements = elements;
  return context;
}

module.exports = { frontend, fakeLocalStorage };
