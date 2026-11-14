import { defineConfig } from '@playwright/test';
const port=process.env.PIP_TEST_PORT??'38941';
export default defineConfig({testDir:'./tests/ui',workers:1,retries:0,timeout:30000,use:{browserName:'chromium',channel:'chrome',viewport:{width:680,height:720},baseURL:`http://127.0.0.1:${port}`},outputDir:process.env.PIP_TEST_OUTPUT??'/tmp/pip-playwright-output',webServer:{command:'python3 scripts/serve-ui.py',url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:10000}});
