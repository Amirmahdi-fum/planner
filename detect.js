(function () {
      var _rdt = null;
      function detect() {
        var isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        var isSmallScreen = window.innerWidth < 768;
        if (isMobileUA || isSmallScreen) {
          document.documentElement.classList.add('mobile-device');
          document.documentElement.classList.remove('pc-device');
        } else {
          document.documentElement.classList.add('pc-device');
          document.documentElement.classList.remove('mobile-device');
        }
      }
      detect();
      window.addEventListener('resize', function () { clearTimeout(_rdt); _rdt = setTimeout(detect, 100); });
    })();
