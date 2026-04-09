const authTabs = document.querySelectorAll(".auth-tab");
const authForms = document.querySelectorAll(".auth-form");
const authMessage = document.querySelector("#auth-message");

function setActiveAuthForm(targetId) {
  authTabs.forEach((tab) => {
    const isActive = tab.dataset.authTarget === targetId;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  authForms.forEach((form) => {
    form.hidden = form.id !== targetId;
  });

  if (authMessage) {
    authMessage.textContent = "";
  }
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveAuthForm(tab.dataset.authTarget);
  });
});

authForms.forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!authMessage) {
      return;
    }

    authMessage.textContent =
      form.id === "login-form"
        ? "Login UI ready. Backend authentication can be connected next."
        : "Signup UI ready. Backend account creation can be connected next.";
  });
});
