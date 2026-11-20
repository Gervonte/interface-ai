import{describe,expect,it}from'vitest';
import{StagehandSurface}from'../apps/automation/src/execution/driver.js';
type Page=ConstructorParameters<typeof StagehandSurface>[0];
describe('closed browser transport classification',()=>{
  it.each(['RPC client is closed','RPC client closed','CDP client is closed','CDP client closed','CDP connection is not open','Stagehand closed'])('classifies the pinned SDK terminal transport error %s as session loss',async message=>{
    const surface=new StagehandSurface({url:async()=>{throw new Error(message);}}as unknown as Page);await expect(surface.location()).rejects.toMatchObject({code:'SESSION_LOST'});
  });
  it('does not classify an arbitrary application error by a substring',async()=>{const error=new Error('A closed account is not available');const surface=new StagehandSurface({url:async()=>{throw error;}}as unknown as Page);await expect(surface.location()).rejects.toBe(error);});
});
