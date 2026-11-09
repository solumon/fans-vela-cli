import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  platform: 'node',
  target: 'node26',
  format: 'esm',
  fixedExtension: true,
  dts: false,
})
