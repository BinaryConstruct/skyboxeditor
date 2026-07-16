/**
 * Script tab: the live scene as editable JSON, two-way.
 *
 *  - Scene → text: whenever the layer stack changes we regenerate the canonical
 *    JSON — but never while the textarea is focused, or we'd clobber the
 *    author's keystrokes mid-edit.
 *  - Text → scene: every edit is parsed + validated; a valid document is
 *    applied to the app's layer state immediately. Invalid input leaves the
 *    scene untouched, paints the editor red, and shows a message that names
 *    where it broke (line:column for JSON syntax, layer/field for schema).
 *
 * It reuses the v2 loader/serializer in core/io.ts, so an untouched
 * serialize→edit-nothing→reparse cycle is byte-stable.
 */
import { useEffect, useRef, useState } from 'react';
import type { Layer } from '../core/layers';
import { parseSceneScript, serializeScene, type ScriptError } from '../core/sceneScript';

interface ScriptTabProps {
  layers: Layer[];
  /** apply a fully-parsed, validated stack to the app */
  onApply: (layers: Layer[]) => void;
}

export function ScriptTab({ layers, onApply }: ScriptTabProps) {
  const [text, setText] = useState(() => serializeScene(layers));
  const [error, setError] = useState<ScriptError | null>(null);
  const editing = useRef(false);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const gutterRef = useRef<HTMLPreElement>(null);

  // scene → text, unless the author is mid-edit (don't overwrite keystrokes)
  useEffect(() => {
    if (editing.current) return;
    setText(serializeScene(layers));
    setError(null);
  }, [layers]);

  const onChange = (value: string) => {
    setText(value);
    const result = parseSceneScript(value);
    if (result.ok) {
      setError(null);
      onApply(result.layers);
    } else {
      setError(result.error);
    }
  };

  const onBlur = () => {
    editing.current = false;
    // resync to the canonical form once editing stops — but only if the last
    // edit was valid, so a broken document stays on screen to be fixed
    if (!error) setText(serializeScene(layersRef.current));
  };

  const lineCount = text.length === 0 ? 1 : text.split('\n').length;

  return (
    <div className="asset-tab script-tab">
      <div className="layer-panel-head">
        <h2>Scene script</h2>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        The whole scene as v2 JSON. Edit here to change any layer; valid edits
        apply live. Built for scripted and AI edits — errors point at the line
        or layer that broke. Schema:{' '}
        <a href="https://skyboxeditor.com/schema/scene.v2.schema.json" target="_blank" rel="noreferrer">
          scene.v2.schema.json
        </a>
      </p>

      <div className={`script-editor${error ? ' invalid' : ''}`}>
        <pre className="script-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </pre>
        <textarea
          className="script-text"
          spellCheck={false}
          wrap="off"
          value={text}
          onFocus={() => { editing.current = true; }}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>

      {error && (
        <p className="script-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
