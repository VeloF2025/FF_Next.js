import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/accounting/credit-notes?type=supplier', permanent: false },
});

export default function Redirect() { return null; }
