#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const port = 8798;
const child = spawn(process.execPath,
  ['tools/simulator/sim.js','examples/music_player/app.js'],
  {cwd:root,env:{...process.env,LUME_SIM_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let output = '';
child.stdout.on('data', b => output += b);
child.stderr.on('data', b => output += b);
(async () => {
  let browser;
  try {
    for (let i=0;i<60 && !output.includes('Host Simulator http://');i++)
      await new Promise(r => setTimeout(r,100));
    assert.match(output,/Host Simulator http:\/\//);
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:600,height:640}});
    await page.goto(`http://localhost:${port}/`);
    await page.getByText('Library',{exact:true}).click();
    await page.getByText('MUSIC LIBRARY',{exact:true}).waitFor();
    fs.mkdirSync(path.join(root,'artifacts/simulator'),{recursive:true});
    await page.locator('#device').screenshot({path:path.join(root,'artifacts/simulator/MusicLibrary.png')});
    console.log('PASS library screenshot=artifacts/simulator/MusicLibrary.png');
    await page.getByText('Back',{exact:true}).click();
    await page.getByText('0:01 / 0:04',{exact:true}).waitFor({timeout:5000});
    await page.locator('#device').screenshot({path:path.join(root,'artifacts/simulator/MusicPlaying.png')});
    console.log('PASS playing lyrics screenshot=artifacts/simulator/MusicPlaying.png');
  } finally { if (browser) await browser.close(); child.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode=1; });
