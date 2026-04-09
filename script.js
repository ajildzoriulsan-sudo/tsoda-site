const revealItems = document.querySelectorAll(
  ".section, .site-footer, .hero-copy, .hero-visual, .request-hero, .request-layout, .request-list-section, .auth-shell, .product-detail-card, .meaning-section"
);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  },
  {
    threshold: 0.2,
  }
);

revealItems.forEach((item) => {
  item.classList.add("reveal");
  observer.observe(item);
});

const interactiveCards = document.querySelectorAll(
  ".product-card, .category-card, .request-card, .hero-card, .request-form-card, .request-side-card, .auth-card, .request-cta-card"
);

interactiveCards.forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    if (window.innerWidth < 961) {
      return;
    }

    const rect = card.getBoundingClientRect();
    const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
    const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

    card.style.transform = `translateY(-6px) rotateX(${offsetY * -3}deg) rotateY(${offsetX * 5}deg)`;
  });

  card.addEventListener("pointerleave", () => {
    card.style.transform = "";
  });
});
