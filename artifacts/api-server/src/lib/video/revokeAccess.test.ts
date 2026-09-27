import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revokeCloudParticipant } from './revokeAccess.ts';
const target={sessionId:42,userId:7,url:'wss://synthetic.livekit.cloud',namespace:'preview'};
test('cloud revocation uses exact namespaced identity and explicit cutoff',async()=>{
  let args:unknown;
  const result=await revokeCloudParticipant(target,{async removeParticipant(...values){args=values;}},1000500);
  assert.deepEqual(result,{revoked:true});
  assert.deepEqual(args,['preview-sikshya42','7',{revokeTokenTs:1002n}]);
});
test('self-hosted and insecure endpoints cannot claim cloud token revocation',async()=>{
  let calls=0;
  for(const url of ['wss://video.example.com','ws://synthetic.livekit.cloud','wss://livekit.cloud.evil.invalid','wss://user:secret@synthetic.livekit.cloud']){
    assert.deepEqual(await revokeCloudParticipant({...target,url},{async removeParticipant(){calls++;}}),{revoked:false,reason:'unsupported_host'});
  }
  assert.equal(calls,0);
});
test('invalid targets and failed provider calls cannot report success',async()=>{
  const port={async removeParticipant(){throw Error('private provider detail');}};
  assert.deepEqual(await revokeCloudParticipant({...target,userId:0},port),{revoked:false,reason:'invalid_target'});
  assert.deepEqual(await revokeCloudParticipant(target,port),{revoked:false,reason:'provider_failed'});
  assert.deepEqual(await revokeCloudParticipant({...target,namespace:'BAD'},port),{revoked:false,reason:'provider_failed'});
});
