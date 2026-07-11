import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-outer" d="M15 19H1V1H15V19Z" fill="var(--icon-strong-base)" />
      <path data-slot="logo-mark-inner" d="M13 17H3V3H13V17Z" fill="var(--icon-base)" />
      <path data-slot="logo-mark-chevron" d="M6 13L9 10L6 7" stroke="var(--icon-strong-base)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M75 95H5V5H75V95Z" fill="var(--icon-strong-base)" />
      <path d="M65 85H15V15H65V85Z" fill="var(--icon-base)" />
      <path d="M30 65L45 50L30 35" stroke="var(--icon-strong-base)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(4, 11)">
        <path d="M15 20H1V1H15V20Z" fill="var(--icon-strong-base)" />
        <path d="M13 18H3V3H13V18Z" fill="var(--icon-base)" />
        <path d="M6 14L9 11L6 8" stroke="var(--icon-strong-base)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </g>
      <text
        x="28"
        y="28"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="20"
        font-weight="600"
        fill="var(--icon-strong-base)"
        letter-spacing="-0.02em"
      >MiMoCode</text>
    </svg>
  )
}
