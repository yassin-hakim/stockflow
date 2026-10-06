import {afterEach,expect,it,vi} from 'vitest';
import {HttpProductCatalog} from '../src/infrastructure/product-http-client';
import {inventoryRequestContext} from '../src/infrastructure/request-context';
afterEach(()=>vi.unstubAllGlobals());
it('preserves request correlation through product validation without putting it in stock identity',async()=>{
 const fetchMock=vi.fn(async(_url:unknown,_options:RequestInit)=>new Response(JSON.stringify({id:'product',archivedAt:null}),{status:200}));vi.stubGlobal('fetch',fetchMock);
 await inventoryRequestContext.run({requestId:'request-test'},()=>new HttpProductCatalog('http://product').get('product'));
 expect(fetchMock.mock.calls[0][1]).toMatchObject({headers:{'X-Request-ID':'request-test'}});
});
it('rejects malformed or mismatched product snapshots before permitting new stock',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({id:'another-product'}),{status:200}));
 await expect(new HttpProductCatalog('http://product').get('product')).rejects.toMatchObject({code:'UPSTREAM_UNAVAILABLE'});
});

