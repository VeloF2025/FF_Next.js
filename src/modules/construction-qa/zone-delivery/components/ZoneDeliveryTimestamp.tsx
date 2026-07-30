interface Props {
  value: string;
  label: string;
}

const formatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZoneName: 'short',
});

export function ZoneDeliveryTimestamp({ value, label }: Props) {
  return <time dateTime={value} aria-label={label}>{formatter.format(new Date(value))}</time>;
}
