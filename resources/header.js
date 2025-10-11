function ajustarEspacamentoHeader() {
  const header = document.getElementById('header');
  if (header) {
    const altura = header.offsetHeight;
    document.body.style.paddingTop = altura + 'px';
  }
}

window.addEventListener('load', ajustarEspacamentoHeader);
window.addEventListener('resize', ajustarEspacamentoHeader);