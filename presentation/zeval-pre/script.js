const slides = Array.from(document.querySelectorAll(".slide"));
const counter = document.querySelector("#counter");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const notes = document.querySelector(".notes");
const noteText = document.querySelector("#noteText");

let current = 0;

function renderSlide(nextIndex) {
  current = Math.max(0, Math.min(slides.length - 1, nextIndex));
  slides.forEach((slide, index) => {
    slide.classList.toggle("active", index === current);
  });
  counter.textContent = `${current + 1} / ${slides.length}`;
  noteText.textContent = slides[current].dataset.notes || "";
  const nextHash = `#${current + 1}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function go(delta) {
  renderSlide(current + delta);
}

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
    event.preventDefault();
    go(1);
  }

  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    go(-1);
  }

  if (event.key.toLowerCase() === "s") {
    notes.classList.toggle("visible");
    notes.setAttribute("aria-hidden", notes.classList.contains("visible") ? "false" : "true");
  }

  if (event.key.toLowerCase() === "f" && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen();
  }
});

function getInitialSlide() {
  const fromHash = Number.parseInt(window.location.hash.replace("#", ""), 10);
  return Number.isFinite(fromHash) ? fromHash - 1 : 0;
}

window.addEventListener("hashchange", () => {
  renderSlide(getInitialSlide());
});

renderSlide(getInitialSlide());
