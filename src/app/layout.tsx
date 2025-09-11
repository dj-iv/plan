import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import ClientOnly from "@/components/ClientOnly";

export const metadata: Metadata = {
  title: "Floorplan Analyzer",
  description: "AI-powered floorplan analysis for area calculation and antenna placement",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Early style to block known desktop overlays (e.g., Grammarly) */}
        <style dangerouslySetInnerHTML={{__html: `
          grammarly-desktop-integration,
          #grammarly-desktop-integration,
          grammarly-extension { display: none !important; visibility: hidden !important; pointer-events: none !important; }
          body > svg, body > canvas { display: none !important; }
        `}} />
        <Script id="block-overlays" strategy="beforeInteractive">
          {`(function(){
            function hide(){
              var sels=['grammarly-desktop-integration','#grammarly-desktop-integration','grammarly-extension'];
              for(var i=0;i<sels.length;i++){
                var nodes=document.querySelectorAll(sels[i]);
                nodes.forEach(function(el){
                  try{el.style.setProperty('display','none','important');el.style.setProperty('visibility','hidden','important');el.style.setProperty('pointer-events','none','important');el.parentNode&&el.parentNode.removeChild(el);}catch(e){}
                });
              }
            }
            function sweep(){
              try {
                var kids = Array.prototype.slice.call(document.body.children || []);
                kids.forEach(function(el){
                  if (!el) return;
                  var isApp = el.id === 'app-root';
                  var isPortal = el.classList && el.classList.contains('nextjs-portal');
                  var isMeasure = el.id === 'measure-overlay' || (el.getAttribute && el.getAttribute('data-keep') === 'true');
                  var tag = (el.tagName||'').toLowerCase();
                  var okTag = tag === 'script' || tag === 'style';
                  if (!(isApp || isPortal || isMeasure || okTag)) {
                    try { el.style.setProperty('display','none','important'); } catch(_) {}
                  }
                });
              } catch(_) {}
            }
            hide();
            sweep();
            var mo = new MutationObserver(function(){ hide(); sweep(); });
            mo.observe(document.documentElement,{childList:true,subtree:true});
          })();`}
        </Script>
      </head>
      <body className="antialiased">
        <div id="app-root">
          {/* Render content after mount to avoid overlay SSR mismatches, but keep SSR shell */}
          <ClientOnly>
            {children}
          </ClientOnly>
        </div>
      </body>
    </html>
  );
}
