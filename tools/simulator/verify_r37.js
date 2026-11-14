#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const port = 8797;
const child = spawn(process.execPath, ['tools/simulator/sim.js','examples/shell_demo/app.js'],
  {cwd:root,env:{...process.env,LUME_SIM_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let output = '';
child.stdout.on('data', b => output += b);
child.stderr.on('data', b => output += b);
(async () => {
  let browser;
  try {
    for (let i=0; i<50 && !output.includes('Host Simulator http://'); i++)
      await new Promise(r => setTimeout(r,100));
    assert.match(output,/Host Simulator http:\/\//);
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:600,height:640}});
    await page.goto(`http://localhost:${port}/`);
    await page.getByText('Dialog',{exact:true}).click();
    await page.getByText('Sample dialog',{exact:true}).waitFor();
    await page.getByText('Next',{exact:true}).click({force:true});
    assert.equal(await page.getByText('page 1 / 3',{exact:true}).count(),1,
      'Dialog card and backdrop intercept the underlying Next button');
    await page.locator('#device').screenshot({path:path.join(root,'artifacts/simulator/Dialog.png')});
    console.log('PASS Dialog visible; underlying touch blocked screenshot=artifacts/simulator/Dialog.png');
    await page.getByText('Cancel',{exact:true}).click();
    await page.getByText('Toast',{exact:true}).click();
    await page.getByText('Saved',{exact:true}).waitFor();
    await page.locator('#device').screenshot({path:path.join(root,'artifacts/simulator/Toast.png')});
    console.log('PASS Toast visible screenshot=artifacts/simulator/Toast.png');
  } finally { if (browser) await browser.close(); child.kill('SIGTERM'); }
})().catch(e => {console.error(e);process.exitCode=1;});
