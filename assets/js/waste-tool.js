export function wasteCost(prepared,discarded,unitCost,days){
  if(![prepared,discarded,unitCost,days].every(Number.isFinite)||prepared<=0||prepared>1000000||discarded<0||discarded>prepared||unitCost<0||unitCost>100000000||!Number.isInteger(days)||days<1||days>31)return null;
  return {daily:discarded*unitCost,ratio:discarded/prepared,period:discarded*unitCost*days};
}
if(typeof document!=='undefined')document.getElementById('waste-tool')?.addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget,values=Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,value.trim()===''?NaN:Number(value)]));const result=wasteCost(values.prepared,values.discarded,values.unitCost,values.days),won=value=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0}).format(value)+'원';
  form.querySelector('output').textContent=result?'하루 폐기 재료비 '+won(result.daily)+' · 준비량 대비 '+(result.ratio*100).toFixed(1)+'% · '+values.days+'일 동일 조건 가정 시 '+won(result.period)+' (순이익·절감 보장액이 아닙니다)':'준비량은 0보다 크게, 폐기량은 준비량 이하, 재료비는 0 이상, 영업일은 1~31의 정수로 입력하세요.';
});
