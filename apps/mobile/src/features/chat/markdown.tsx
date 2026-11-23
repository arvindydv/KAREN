import { inlineText, isSafeLinkUrl, parseMarkdown, type MdBlock, type MdInline } from '@karen/ui';
import { memo, useMemo } from 'react';
import { Linking, Platform, Pressable, Share, Text, View, type TextStyle } from 'react-native';
import { reportError } from '../../lib/error-reporting';
import { useTheme, type NativeTheme } from '../../theme/theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

function openLink(href: string) {
  // Defence in depth: the parser only emits safe links, but never open anything else.
  if (!isSafeLinkUrl(href)) return;
  Linking.openURL(href).catch((err: unknown) => reportError(err, { op: 'open_link' }));
}

function Inlines({ nodes, t, base }: { nodes: MdInline[]; t: NativeTheme; base?: TextStyle }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return n.text;
          case 'br':
            return '\n';
          case 'strong':
            return (
              <Text key={i} style={[base, { fontWeight: '700' }]}>
                <Inlines nodes={n.children} t={t} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} style={[base, { fontStyle: 'italic' }]}>
                <Inlines nodes={n.children} t={t} />
              </Text>
            );
          case 'code':
            return (
              <Text
                key={i}
                style={{ fontFamily: MONO, backgroundColor: t.glass.fill, fontSize: 14 }}
              >
                {n.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                accessibilityRole="link"
                accessibilityHint={`Opens ${n.href} in your browser`}
                onPress={() => openLink(n.href)}
                style={{ color: t.colors.highlight, textDecorationLine: 'underline' }}
              >
                <Inlines nodes={n.children} t={t} />
              </Text>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function CodeBlock({ text, lang, t }: { text: string; lang: string | null; t: NativeTheme }) {
  return (
    <View
      style={{
        backgroundColor: t.glass.fill,
        borderColor: t.glass.border,
        borderWidth: 1,
        borderRadius: t.radius.md,
        padding: t.spacing.sm,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.colors.textSecondary, fontSize: 12 }}>{lang ?? 'code'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy or share code"
          hitSlop={8}
          onPress={() =>
            void Share.share({ message: text }).catch((err: unknown) =>
              reportError(err, { op: 'share_code' }),
            )
          }
          style={{
            minHeight: t.minTouchTarget,
            minWidth: t.minTouchTarget,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: t.colors.highlight, fontSize: 13, fontWeight: '600' }}>Copy</Text>
        </Pressable>
      </View>
      <Text selectable style={{ fontFamily: MONO, fontSize: 13, color: t.colors.textPrimary }}>
        {text}
      </Text>
    </View>
  );
}

function Block({ block, t, color }: { block: MdBlock; t: NativeTheme; color: string }) {
  const body: TextStyle = { color, fontSize: t.typography.scale.body.size, lineHeight: 24 };
  switch (block.type) {
    case 'paragraph':
      return (
        <Text selectable style={body}>
          <Inlines nodes={block.children} t={t} />
        </Text>
      );
    case 'heading':
      return (
        <Text
          selectable
          accessibilityRole="header"
          style={[body, { fontWeight: '700', fontSize: [20, 18, 17][block.level - 1] }]}
        >
          <Inlines nodes={block.children} t={t} />
        </Text>
      );
    case 'code':
      return <CodeBlock text={block.text} lang={block.lang} t={t} />;
    case 'list':
      return (
        <View style={{ gap: 4 }} accessibilityRole="list">
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={body}>{block.ordered ? `${block.start + i}.` : '•'}</Text>
              <Text selectable style={[body, { flex: 1 }]}>
                <Inlines nodes={item} t={t} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View
          style={{ borderLeftWidth: 3, borderLeftColor: t.glass.border, paddingLeft: 8, gap: 6 }}
        >
          {block.children.map((b, i) => (
            <Block key={i} block={b} t={t} color={t.colors.textSecondary} />
          ))}
        </View>
      );
    case 'hr':
      return <View style={{ height: 1, backgroundColor: t.glass.border }} />;
    case 'table':
      // Small screens: one card per row ("Header: value") instead of a wide grid.
      return (
        <View style={{ gap: 6 }}>
          {block.rows.map((row, r) => (
            <View
              key={r}
              style={{ borderWidth: 1, borderColor: t.glass.border, borderRadius: 8, padding: 6 }}
            >
              {row.map((cell, c) => (
                <Text key={c} selectable style={body}>
                  <Text style={{ fontWeight: '700' }}>
                    {inlineText(block.header[c] ?? [])}
                    {': '}
                  </Text>
                  <Inlines nodes={cell} t={t} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

/** Renders chat Markdown natively. No HTML, no WebView; only http(s)/mailto links open. */
export const MarkdownText = memo(function MarkdownText({
  source,
  color,
}: {
  source: string;
  color?: string;
}) {
  const t = useTheme();
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} t={t} color={color ?? t.colors.textPrimary} />
      ))}
    </View>
  );
});
