(function(){
  var btn=document.querySelector('.menu-btn'),nav=document.getElementById('nav');
  if(btn&&nav){btn.addEventListener('click',function(){
    var open=nav.classList.toggle('open');btn.setAttribute('aria-expanded',open?'true':'false');});}
  var form=document.getElementById('quote-form');
  if(form){form.addEventListener('submit',function(e){
    e.preventDefault();
    var f=form.elements;
    var subject='Quote request: '+(f.service.value||'General');
    var body='Name: '+f.name.value+'\nPhone or email: '+f.reply.value+'\nService: '+f.service.value+'\n\n'+f.message.value;
    window.location.href='mailto:contact@1aws.net?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  });}
})();
