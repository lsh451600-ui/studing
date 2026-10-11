import test from 'node:test';
import assert from 'node:assert/strict';
import { wasteCost } from '../assets/js/waste-tool.js';
test('waste cost uses actual discarded portions and explicitly assumed days',()=>{assert.deepEqual(wasteCost(50,8,2500,25),{daily:20000,ratio:.16,period:500000});assert.deepEqual(wasteCost(50,0,2500,25),{daily:0,ratio:0,period:0});assert.equal(wasteCost(4,1.5,100,2).daily,150);});
test('inconsistent quantities and invalid periods cannot produce a waste estimate',()=>{for(const args of [[0,1,2500,25],[5,6,100,25],[50,-1,100,25],[50,8,-1,25],[50,8,100,0],[50,8,100,32],[50,8,100,2.5],[NaN,8,100,25]])assert.equal(wasteCost(...args),null);});
