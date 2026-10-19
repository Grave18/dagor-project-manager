const vscode=acquireVsCodeApi();
        const prefersReducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let projectPanelAnimation;
        const enteringPanel=document.querySelector('.project-actions.opening');
        if(enteringPanel&&prefersReducedMotion){
          enteringPanel.style.height='auto';
          enteringPanel.classList.remove('opening');
        }else if(enteringPanel&&enteringPanel.animate){
          const fromHeight=enteringPanel.getBoundingClientRect().height;
          const initialHeight=enteringPanel.style.height;
          enteringPanel.style.height='auto';
          const height=enteringPanel.getBoundingClientRect().height;
          enteringPanel.style.height=initialHeight;
          const expanding=height>=fromHeight;
          const easing=expanding?'cubic-bezier(.22,1,.36,1)':'cubic-bezier(.4,0,1,1)';
          const animation=enteringPanel.animate([{height:fromHeight+'px',opacity:0.96,transform:'translateY(0)'},{height:height+'px',opacity:1,transform:'translateY(0)'}],{duration:260,easing});
          const content=enteringPanel.querySelector('.action-grid');
          if(content&&content.animate){
            const shift=expanding?-8:8;
            content.animate([{opacity:0.7,transform:'translateY('+shift+'px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing});
          }
          animation.onfinish=()=>{enteringPanel.style.height='auto';enteringPanel.classList.remove('opening');};
        }
        const selectProject=projectId=>{
          if(projectPanelAnimation){projectPanelAnimation.cancel();projectPanelAnimation=undefined;}
          const panel=document.querySelector('.project-actions');
          if(panel&&panel.dataset.project===projectId&&!prefersReducedMotion&&panel.animate){
            const height=panel.getBoundingClientRect().height;
            projectPanelAnimation=panel.animate([{height:height+'px',opacity:1,transform:'translateY(0)'},{height:'0px',opacity:0,transform:'translateY(-6px)'}],{duration:220,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
            projectPanelAnimation.onfinish=()=>{projectPanelAnimation=undefined;vscode.postMessage({type:'toggleProject',project:projectId});};
          }else if(panel&&panel.dataset.project===projectId){
            vscode.postMessage({type:'toggleProject',project:projectId});
          }else{
            const fromHeight=panel?panel.getBoundingClientRect().height:0;
            vscode.postMessage({type:'selectProject',project:projectId,fromHeight});
          }
        };
        document.addEventListener('contextmenu',event=>{
          const item=event.target.closest('[data-context-kind]');
          vscode.postMessage({type:'setContextTarget',target:item?{
            kind:item.dataset.contextKind,
            project:item.dataset.contextProject,
            path:item.dataset.contextPath
          }:null});
        },true);
        const projectFor=element=>JSON.parse(element.closest('.project-actions').dataset.projectData);
        document.getElementById('refresh').addEventListener('click',()=>{
  if(document.getElementById('refresh').disabled)return;
  vscode.postMessage({type:'refresh'});
});
document.getElementById('add-project').addEventListener('click',()=>{const button=document.getElementById('add-project');if(button.disabled)return;vscode.postMessage({type:'addProject'});});
const blockButtonsFor2s=()=>{
  const buttons=document.querySelectorAll('.action[data-action]:not([data-action="build"]):not([data-action="submitBuild"]), .scene[data-scene], .game[data-game], .game-command[data-game-command], .create-command, .create-scene');
  buttons.forEach(btn=>btn.disabled=true);
  setTimeout(()=>buttons.forEach(btn=>btn.disabled=false),5000);
};
        document.addEventListener('click',event=>{
          const select=event.target.closest('[data-select]');if(select){selectProject(select.dataset.select);return;}
          const scene=event.target.closest('[data-scene]');if(scene){vscode.postMessage({type:'openScene',project:projectFor(scene),scene:scene.dataset.scene});blockButtonsFor2s();return;}
          const game=event.target.closest('[data-game]');if(game){vscode.postMessage({type:'runGame',project:projectFor(game),executable:game.dataset.game});blockButtonsFor2s();return;}
          const gameCommand=event.target.closest('[data-game-command]');if(gameCommand){vscode.postMessage({type:'runGameCommand',project:projectFor(gameCommand),command:gameCommand.dataset.gameCommand});blockButtonsFor2s();return;}
          const createCommand=event.target.closest('[data-create-command]');if(createCommand){if(createCommand.disabled)return;vscode.postMessage({type:'createGameCommand',project:projectFor(createCommand)});blockButtonsFor2s();return;}
          const createScene=event.target.closest('[data-create-scene]');if(createScene){if(createScene.disabled)return;vscode.postMessage({type:'createScene',project:projectFor(createScene)});blockButtonsFor2s();return;}
          const button=event.target.closest('[data-action]');if(!button)return;
          if(button.dataset.action==='toggleScenes'||button.dataset.action==='toggleGames'||button.dataset.action==='toggleGameCommands'){
            const content=button.nextElementSibling;
            const expanding=content.hidden;
            const group=button.closest('.scene-group');
            const animate=group&&group.animate&&!prefersReducedMotion;
            if(animate){
              const fromHeight=group.getBoundingClientRect().height;
              content.hidden=!expanding;
              const height=group.getBoundingClientRect().height;
              content.hidden=!content.hidden;
              const animation=group.animate([{height:fromHeight+'px'},{height:height+'px'}],{duration:220,easing:expanding?'cubic-bezier(.22,1,.36,1)':'cubic-bezier(.4,0,1,1)'});
              group.style.overflow='hidden';
              animation.onfinish=()=>{
                content.hidden=!expanding;
                group.style.height='';
                group.style.overflow='';
              };
            }else{
              content.hidden=!expanding;
            }
            button.setAttribute('aria-expanded',String(expanding));
            button.querySelector('.end-chevron').classList.toggle('expanded',expanding);
            return;
          }
          if(button.dataset.action==='build'){
            const actions=button.closest('.project-actions');
            if(actions.dataset.running==='true'){
              vscode.postMessage({type:'stopBuild',project:projectFor(button)});
            }else{
              const components=actions.querySelector('.components');
              const visible=components.classList.toggle('visible');
              button.setAttribute('aria-expanded',String(visible));
            }
            return;
          }
          if(button.dataset.action==='submitBuild'){
            const actions=button.closest('.project-actions');
            if(actions.dataset.running==='true'){
              vscode.postMessage({type:'stopBuild',project:projectFor(button)});
              return;
            }
            const components=[...actions.querySelectorAll('.component input:checked')].map(input=>input.value);
            if(components.length===0)return;
            vscode.postMessage({type:'action',action:'build',project:projectFor(button),components});
            return;
          }
          const project=projectFor(button);
          const action=button.dataset.action;
          vscode.postMessage(action==='stop'?{type:'stopBuild',project}:{type:'action',action,project});
          if(action!=='build'&&action!=='submitBuild')blockButtonsFor2s();
        });
        window.addEventListener('message',event=>{
          const message=event.data;
          if(message.type!=='buildState')return;
          const actions=[...document.querySelectorAll('.project-actions')].find(item=>JSON.parse(item.dataset.projectData).applicationFile===message.project);
          if(!actions)return;
          actions.dataset.running=String(message.running);
          const submit=actions.querySelector('.build-submit');
          submit.classList.toggle('running',message.running);
          submit.querySelector('.build-label').textContent=message.running?submit.dataset.stopBuildLabel:submit.dataset.buildLabel;
          submit.setAttribute('aria-label',message.running?submit.dataset.stopBuildLabel:submit.dataset.buildLabel);
        });
        window.addEventListener('load',()=>vscode.postMessage({type:'ready'}));
