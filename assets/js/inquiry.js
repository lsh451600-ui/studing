const inquiryForm=document.getElementById('partnership-form');
const inquirySubmit=document.getElementById('inquiry-submit');
const inquiryStatus=document.getElementById('inquiry-status');
let inquiryPending=false;
inquiryForm.addEventListener('submit',async event=>{
 event.preventDefault();
 if(inquiryPending||!inquiryForm.reportValidity())return;
 inquiryPending=true;
 const payload=new FormData(inquiryForm);
 inquirySubmit.disabled=true;inquirySubmit.textContent='전송 중…';inquiryForm.setAttribute('aria-busy','true');
 inquiryStatus.dataset.state='pending';inquiryStatus.textContent='문의 내용을 전송하고 있습니다.';
 try{
  const response=await fetch(inquiryForm.action,{method:'POST',body:payload,headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('submission_failed');
  inquiryForm.reset();inquiryStatus.dataset.state='success';inquiryStatus.textContent='질문 문의가 접수되었습니다. 보내주셔서 감사합니다.';
 }catch(error){
  inquiryStatus.dataset.state='error';inquiryStatus.textContent='문의를 전송하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.';
 }finally{
  inquiryPending=false;inquirySubmit.disabled=false;inquirySubmit.textContent='문의 보내기 ↗';inquiryForm.removeAttribute('aria-busy');
 }
});

