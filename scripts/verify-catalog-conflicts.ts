import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Product,ApiError} from '@stockflow/contracts';

async function main(){
  const base=process.env.PRODUCT_URL??'http://localhost:3101';
  const suffix=randomUUID().slice(0,8);
  async function request<T>(path:string,method='GET',body?:unknown,status=200):Promise<T>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value as T;
  }
  const product=await request<Product>('/products','POST',{name:`Catalog conflict ${suffix}`,unit:'kg',category:'Verification',sku:`CODE-${suffix}`},201);
  const duplicate=await request<ApiError>('/products','POST',{name:`Duplicate SKU ${suffix}`,unit:'L',category:'Verification',sku:product.sku!.toLowerCase()},409);
  assert.equal(duplicate.error.code,'SKU_CONFLICT');
  const edited=await request<Product>(`/products/${product.id}`,'PATCH',{name:`Edited coffee ${suffix}`,category:product.category,lowStockThreshold:5,sku:product.sku,expectedVersion:product.version});
  const stale=await request<ApiError>(`/products/${product.id}`,'PATCH',{name:`Stale coffee ${suffix}`,category:product.category,lowStockThreshold:7,sku:product.sku,expectedVersion:product.version},409);
  assert.equal(stale.error.code,'VERSION_CONFLICT');
  assert.deepEqual(await request(`/products/${product.id}`),edited);
  const invalidUnit=await request<ApiError>(`/products/${product.id}`,'PATCH',{unit:'L',expectedVersion:edited.version},400);
  assert.equal(invalidUnit.error.code,'INVALID_REQUEST');
  assert.deepEqual(await request(`/products/${product.id}`),edited);
  mkdirSync('output/verification',{recursive:true});
  writeFileSync('output/verification/catalog-http-conflicts.json',JSON.stringify({base,product,duplicate,edited,stale,invalidUnit,assertions:['normalized SKU HTTP409','stale edit HTTP409 preserves committed product','base unit mutation HTTP400 preserves original unit'],completedAt:new Date().toISOString()},null,2));
  console.log('PASS real Product HTTP normalized SKU conflict, stale edit conflict and immutable unit; saved records unchanged by rejected commands.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
