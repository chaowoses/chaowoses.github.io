const obs = new IntersectionObserver(entries=>{
  entries.forEach((e,i)=>{
    if(e.isIntersecting) setTimeout(()=>e.target.classList.add('in'),i*80);
  });
},{threshold:0.1});
document.querySelectorAll('.rev').forEach(el=>obs.observe(el));

// mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
toggle?.addEventListener('click',()=>{
  links.classList.toggle('open');
  document.body.style.overflow = links.classList.contains('open') ? 'hidden' : '';
  toggle.innerHTML = links.classList.contains('open')
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-12 12"></path><path d="M6 6l12 12"></path></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l16 0"></path><path d="M4 12l16 0"></path><path d="M4 18l16 0"></path></svg>';
});
document.querySelectorAll('.nav-links a').forEach(a=>{
  a.addEventListener('click',()=>{
    links.classList.remove('open');
    document.body.style.overflow = '';
    toggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l16 0"></path><path d="M4 12l16 0"></path><path d="M4 18l16 0"></path></svg>';
  });
});
