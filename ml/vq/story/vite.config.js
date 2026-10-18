import {defineConfig} from 'vite';
export default defineConfig({
  server:{host:'127.0.0.1',strictPort:true},
  build:{rollupOptions:{output:{manualChunks(id){
    if(id.includes('node_modules/three'))return 'three';
    if(id.endsWith('catalog.json'))return 'source-catalog';
  }}}}
});
