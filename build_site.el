;; Set the package installation directory so that packages aren't stored in the
;; ~/.emacs.d/elpa path.
(require 'package)
(setq package-user-dir (expand-file-name "./.packages"))
(setq package-archives '(("melpa" . "https://melpa.org/packages/")
                         ("elpa" . "https://elpa.gnu.org/packages/")))

;; For babel, disable the need for confirmation of code running
(setq org-confirm-babel-evaluate nil)

;; Initialize the package system
(package-initialize)
(unless package-archive-contents
  (package-refresh-contents))

;; Install dependencies
(package-install 'htmlize)

;; Load the htmlize package (dev)
(require 'htmlize)

;; Enable syntax highlighting in exported HTML (dev)
(setq org-html-htmlize-output-type 'css)

;; Load the publishing system
(require 'ox-publish)

;; Customize the HTML output
;;(setq org-html-validation-link nil            ;; Don't show validation link
;;      org-html-head-include-scripts nil       ;; Use our own scripts
;;      org-html-head-include-default-style nil ;; Use our own styles
;;      org-html-head "<link rel=\"stylesheet\" href=\"simple.css\" />") ;; links to local css
      ;; org-html-head "<link rel=\"stylesheet\" href=\"https://cdn.simplecss.org/simple.min.css\" />")

;; Dev: Toggle dark mode
(setq org-html-validation-link nil
      org-html-head-include-scripts nil
      org-html-head-include-default-style nil
      org-html-head "<link rel=\"stylesheet\" href=\"simple.css\" />
<style>
  .dark-mode {
    --bg: #212121;
    --accent-bg: #2b2b2b;
    --text: #dcdcdc;
    --text-light: #ababab;
    --accent: #ffb300;
    /*--code: #f06292;*/
    --preformatted: #ccc;
    --disabled: #111;
  }
  .dark-mode img,
  .dark-mode video {
    opacity: 0.8;
  }
  .toggle-theme-btn {
      transform: scale(0.7);
      opacity: 0.4;
      transition: opacity 0.2s;
    }
    .toggle-theme-btn:hover {
      opacity: 0.4;
    }
</style>
<script>
 function toggleDarkMode() {
    const body = document.body;
    body.classList.toggle(\"dark-mode\");
    // Save the user's theme preference to localStorage
    if (body.classList.contains(\"dark-mode\")) {
      localStorage.setItem(\"theme\", \"dark\");
    } else {
      localStorage.setItem(\"theme\", \"light\");
    }
  }

  function setDefaultDarkMode() {
    // Retrieve the user's theme preference from localStorage
    const storedTheme = localStorage.getItem(\"theme\");

    // If the stored theme is light, do nothing; otherwise, set it to dark
    if (storedTheme !== \"light\") {
      document.body.classList.add(\"dark-mode\");
    }
  }

  // Set the default mode to dark when the DOM is fully loaded
  document.addEventListener('DOMContentLoaded', setDefaultDarkMode);
</script>")

;; Dev: The light/dark mode button, others
(setq org-html-preamble
      "<div style=\"position: fixed; top: 10px; right: 10px;\">
         <button class=\"toggle-theme-btn\" onclick=\"toggleDarkMode()\">Light/Dark</button>
       </div>")

;; Define the publishing project
(setq org-publish-project-alist
      (list
       (list "tyler_burns_website"
             :recursive t
             :base-directory "./content"
             :publishing-directory "./public"
             :with_date t
             :with-author nil           ;; Don't include author name
             :with-creator t            ;; Include Emacs and Org versions in footer
             :with-toc nil                ;; Include a table of contents
             :section-numbers nil       ;; Don't include section numbers
             :time-stamp-file nil       ;; Don't include time stamp in file
             :publishing-function 'org-html-publish-to-html)))


;; Get rid of "validate" on bottom of site
(setq org-html-validation-link nil) 

;; Generate the site output
(org-publish-all t)

(message "build complete!")
