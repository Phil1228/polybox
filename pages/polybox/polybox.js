(() => {
  const THEME_KEY = "minimaths_theme";
  const TOKEN_KEY = "minimaths_user_token";
  const AUTOPLAY_MS = 6000;

  function applyTheme(value) {
    const root = document.documentElement;
    if (value === "light" || value === "dark") {
      root.setAttribute("data-theme", value);
      localStorage.setItem(THEME_KEY, value);
      return;
    }
    root.setAttribute("data-theme", "light");
    localStorage.removeItem(THEME_KEY);
  }

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  const avatarImg = document.getElementById("user-avatar");
  const fallbackIcon = document.getElementById("user-avatar-fallback");
  const token = localStorage.getItem(TOKEN_KEY) || "";

  if (avatarImg && fallbackIcon && token) {
    fetch("/api/users/me", {
      headers: { Authorization: "Bearer " + token },
    })
      .then((res) => res.json())
      .then((data) => {
        const avatar = data && data.user && data.user.avatar ? data.user.avatar : "";
        if (!avatar) return;
        avatarImg.src = avatar;
        avatarImg.style.display = "block";
        fallbackIcon.style.display = "none";
      })
      .catch(() => {});
  }

  function initCarousel() {
    const carousel = document.querySelector(".hero.carousel");
    const track = document.getElementById("carousel-track");
    const slides = track ? [...track.querySelectorAll(".carousel-slide")] : [];
    const dots = document.querySelectorAll(".carousel-dot");
    const prevBtn = document.getElementById("carousel-prev");
    const nextBtn = document.getElementById("carousel-next");
    const live = document.getElementById("carousel-live");

    if (!carousel || !track || slides.length === 0) return;

    let currentIndex = 0;
    let autoplayTimer = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function goTo(index) {
      const count = slides.length;
      currentIndex = ((index % count) + count) % count;
      track.style.transform = `translateX(-${currentIndex * 100}%)`;

      slides.forEach((slide, i) => {
        const active = i === currentIndex;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", active ? "false" : "true");
        slide.querySelectorAll("a, button").forEach((el) => {
          if (active) el.removeAttribute("tabindex");
          else el.setAttribute("tabindex", "-1");
        });
      });

      dots.forEach((dot, i) => {
        const active = i === currentIndex;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });

      if (live) {
        live.textContent = `第 ${currentIndex + 1} 张，共 ${count} 张`;
      }
    }

    function next() {
      goTo(currentIndex + 1);
    }

    function prev() {
      goTo(currentIndex - 1);
    }

    function startAutoplay() {
      if (reducedMotion || slides.length <= 1) return;
      stopAutoplay();
      autoplayTimer = window.setInterval(next, AUTOPLAY_MS);
    }

    function stopAutoplay() {
      if (autoplayTimer !== null) {
        window.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
    }

    prevBtn?.addEventListener("click", () => {
      prev();
      startAutoplay();
    });

    nextBtn?.addEventListener("click", () => {
      next();
      startAutoplay();
    });

    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        const to = Number(dot.getAttribute("data-slide-to"));
        if (Number.isFinite(to)) goTo(to);
        startAutoplay();
      });
    });

    carousel.addEventListener("mouseenter", stopAutoplay);
    carousel.addEventListener("mouseleave", startAutoplay);
    carousel.addEventListener("focusin", stopAutoplay);
    carousel.addEventListener("focusout", (e) => {
      if (!carousel.contains(e.relatedTarget)) startAutoplay();
    });

    carousel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
        startAutoplay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
        startAutoplay();
      }
    });

    goTo(0);
    startAutoplay();
  }

  initCarousel();

  if (!("IntersectionObserver" in window)) return;

  const navLinks = document.querySelectorAll(".main-nav a[href^='#']");
  const sections = [...navLinks]
    .map((link) => {
      const id = link.getAttribute("href").slice(1);
      const el = document.getElementById(id);
      return el ? { link, el } : null;
    })
    .filter(Boolean);

  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = visible.target.id;
      navLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
      });
    },
    { rootMargin: "-35% 0px -55% 0px", threshold: [0, 0.15, 0.4] }
  );

  sections.forEach(({ el }) => observer.observe(el));
})();
